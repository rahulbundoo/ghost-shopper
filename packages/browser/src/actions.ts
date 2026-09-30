import { z } from 'zod';
import type { Page } from 'playwright';
import type { JourneyActionName, StepErrorCode, TestRun } from '@ghostshopper/domain';
import { type LocatorResolver, addToCartStrategies, checkoutStrategies } from './locators.js';

const numericId = z.union([
  z.number().int().positive().safe().transform(String),
  z.string().regex(/^[1-9]\d*$/),
]);
const productSchema = z.object({
  id: numericId,
  handle: z.string().regex(/^[a-z0-9-]+$/),
  options: z
    .array(z.union([z.string(), z.object({ name: z.string() }).transform((v) => v.name)]))
    .max(3),
  variants: z
    .array(z.object({ id: numericId, available: z.boolean(), options: z.array(z.string()).max(3) }))
    .max(2048),
});
const cartSchema = z.object({
  item_count: z.number().int().nonnegative(),
  items: z
    .array(
      z.object({
        variant_id: numericId,
        product_id: numericId,
        quantity: z.number().int().positive(),
      }),
    )
    .max(100),
});
type Product = z.output<typeof productSchema>;
export class ActionFailure extends Error {
  constructor(readonly code: StepErrorCode) {
    super(code);
  }
}
export interface JourneyContext {
  page: Page;
  run: TestRun;
  origin: string;
  root: string;
  resolver: LocatorResolver;
  product?: Product;
  variant?: Product['variants'][number];
  checkoutStarted: boolean;
}
export interface JourneyAction {
  readonly name: JourneyActionName;
  readonly failureCode: StepErrorCode;
  execute(context: JourneyContext): Promise<void>;
}
export async function storefrontJson(page: Page, path: string): Promise<unknown> {
  // Browser fetch goes through the same routes, cookies and pinned egress proxy.
  return page.evaluate(async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) throw new Error('STOREFRONT_RESPONSE');
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('STOREFRONT_RESPONSE_SIZE');
    return JSON.parse(text) as unknown;
  }, path);
}
async function navigate(context: JourneyContext, path: string) {
  const response = await context.page.goto(new URL(path, context.origin).href, {
    waitUntil: 'domcontentloaded',
  });
  if (!response || !response.ok()) throw new ActionFailure('PAGE_UNAVAILABLE');
  if (new URL(context.page.url()).origin !== context.origin)
    throw new ActionFailure('UNSAFE_NAVIGATION');
}
export class OpenHomepageAction implements JourneyAction {
  readonly name = 'OPEN_HOME';
  readonly failureCode = 'PAGE_UNAVAILABLE';
  async execute(context: JourneyContext) {
    await navigate(context, '/');
    if (/\/password\/?$/.test(new URL(context.page.url()).pathname))
      throw new ActionFailure('PAGE_UNAVAILABLE');
    const root = await context.page.evaluate(() => {
      const shopify = (window as unknown as { Shopify?: { routes?: { root?: unknown } } }).Shopify;
      return shopify?.routes?.root;
    });
    context.root =
      typeof root === 'string' && /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?$/i.test(root) ? root : '/';
    const cart = cartSchema.parse(await storefrontJson(context.page, `${context.root}cart.js`));
    if (cart.item_count !== 0 || cart.items.length !== 0) throw new ActionFailure('CART_FAILURE');
  }
}
export class FindProductAction implements JourneyAction {
  readonly name = 'FIND_PRODUCT';
  readonly failureCode = 'PRODUCT_NOT_FOUND';
  async execute(context: JourneyContext) {
    const visited = new Set<string>();
    // Bounded public discovery, no Admin credentials or undocumented catalog endpoint.
    for (let page = 0; page <= 3; page++) {
      if (page > 0) await navigate(context, `${context.root}collections/all?page=${page}`);
      const links = await context.page
        .getByRole('link')
        .evaluateAll((nodes) =>
          nodes
            .map((node) => node.getAttribute('href'))
            .filter((href): href is string => Boolean(href)),
        );
      for (const href of links) {
        const url = new URL(href, context.page.url());
        if (url.origin !== context.origin) continue;
        const handle = /\/products\/([a-z0-9-]+)\/?$/.exec(url.pathname)?.[1];
        if (!handle || visited.has(handle)) continue;
        if (visited.size >= 60) throw new ActionFailure('PRODUCT_NOT_FOUND');
        visited.add(handle);
        const data = productSchema.safeParse(
          await storefrontJson(context.page, `${context.root}products/${handle}.js`),
        );
        if (data.success && `gid://shopify/Product/${data.data.id}` === context.run.productId) {
          context.product = data.data;
          return;
        }
      }
    }
    throw new ActionFailure('PRODUCT_NOT_FOUND');
  }
}
export class OpenProductAction implements JourneyAction {
  readonly name = 'OPEN_PRODUCT';
  readonly failureCode = 'PRODUCT_NOT_FOUND';
  async execute(context: JourneyContext) {
    if (!context.product) throw new ActionFailure(this.failureCode);
    await navigate(context, `${context.root}products/${context.product.handle}`);
    const current = productSchema.parse(
      await storefrontJson(context.page, `${context.root}products/${context.product.handle}.js`),
    );
    if (`gid://shopify/Product/${current.id}` !== context.run.productId)
      throw new ActionFailure(this.failureCode);
    context.product = current;
    await context.page.locator('form[action$="/cart/add"]').first().waitFor({ state: 'attached' });
  }
}
async function selectedId(context: JourneyContext): Promise<string | null> {
  const button = await context.resolver.resolve(context.page, addToCartStrategies);
  return button.evaluate((element) => {
    const form = (element as HTMLButtonElement).form;
    if (!form) return null;
    const value = new FormData(form).get('id');
    return typeof value === 'string' ? value : null;
  });
}
export class SelectVariantAction implements JourneyAction {
  readonly name = 'SELECT_VARIANT';
  readonly failureCode = 'VARIANT_SELECTOR_FAILURE';
  async execute(context: JourneyContext) {
    const product = context.product;
    if (!product) throw new ActionFailure(this.failureCode);
    const variant = context.run.variantId
      ? product.variants.find(
          (v) => `gid://shopify/ProductVariant/${v.id}` === context.run.variantId,
        )
      : product.variants.find((v) => v.available);
    if (!variant?.available) throw new ActionFailure('VARIANT_UNAVAILABLE');
    context.variant = variant;
    if ((await selectedId(context)) === variant.id) return;
    const select = context.page
      .locator('form[action$="/cart/add"] select[name="id"]')
      .filter({ visible: true });
    if ((await select.count()) === 1) await select.selectOption(variant.id);
    else {
      for (let index = 0; index < product.options.length; index++) {
        const value = variant.options[index];
        const name = product.options[index];
        if (!value || !name) throw new ActionFailure(this.failureCode);
        const dropdown = context.page
          .getByLabel(name, { exact: true })
          .and(context.page.locator('select'))
          .filter({ visible: true });
        if ((await dropdown.count()) === 1) await dropdown.selectOption({ label: value });
        else {
          const radio = await context.resolver.resolve(context.page, [
            {
              name: 'option-group',
              locate: (p) =>
                p
                  .getByRole('group', { name, exact: true })
                  .getByRole('radio', { name: value, exact: true }),
            },
            {
              name: 'option-label',
              locate: (p) => p.getByRole('radio', { name: value, exact: true }),
            },
          ]);
          await radio.check();
        }
      }
    }
    await context.page.waitForFunction(
      (id) =>
        Array.from(document.querySelectorAll<HTMLFormElement>('form[action$="/cart/add"]')).some(
          (form) => new FormData(form).get('id') === id,
        ),
      variant.id,
    );
    if ((await selectedId(context)) !== variant.id) throw new ActionFailure(this.failureCode);
  }
}
async function verifyCart(context: JourneyContext) {
  const cart = cartSchema.parse(await storefrontJson(context.page, `${context.root}cart.js`));
  if (
    cart.item_count !== 1 ||
    cart.items.length !== 1 ||
    cart.items[0]?.quantity !== 1 ||
    cart.items[0]?.variant_id !== context.variant?.id ||
    `gid://shopify/Product/${cart.items[0]?.product_id}` !== context.run.productId
  )
    throw new ActionFailure('CART_FAILURE');
}
export class AddToCartAction implements JourneyAction {
  readonly name = 'ADD_TO_CART';
  readonly failureCode = 'ADD_TO_CART_FAILURE';
  async execute(context: JourneyContext) {
    if (!context.variant || (await selectedId(context)) !== context.variant.id)
      throw new ActionFailure(this.failureCode);
    const button = await context.resolver.resolve(context.page, addToCartStrategies);
    const response = context.page.waitForResponse(
      (r) =>
        /\/cart\/add(?:\.js)?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    );
    // Observe both promises immediately, avoiding unhandled rejections when clicking fails.
    const [added] = await Promise.all([response, button.click()]);
    if (added.status() >= 400) throw new ActionFailure(this.failureCode);
    await context.page.waitForLoadState('domcontentloaded');
    await verifyCart(context);
  }
}
export class OpenCartAction implements JourneyAction {
  readonly name = 'OPEN_CART';
  readonly failureCode = 'CART_FAILURE';
  async execute(context: JourneyContext) {
    await navigate(context, `${context.root}cart`);
    await verifyCart(context);
    await context.resolver.resolve(context.page, checkoutStrategies);
  }
}
export class BeginCheckoutAction implements JourneyAction {
  readonly name = 'BEGIN_CHECKOUT';
  readonly failureCode = 'CHECKOUT_FAILURE';
  async execute(context: JourneyContext) {
    await verifyCart(context);
    const button = await context.resolver.resolve(context.page, checkoutStrategies);
    context.checkoutStarted = true;
    const navigation = context.page.waitForURL(
      (url) => url.origin === context.origin && /\/checkouts\/[^/]+/.test(url.pathname),
      { waitUntil: 'domcontentloaded' },
    );
    await Promise.all([navigation, button.click()]);
    // Deliberately no checkout fields, buttons, payment APIs or additional actions.
  }
}
export const purchaseJourney: readonly JourneyAction[] = [
  new OpenHomepageAction(),
  new FindProductAction(),
  new OpenProductAction(),
  new SelectVariantAction(),
  new AddToCartAction(),
  new OpenCartAction(),
  new BeginCheckoutAction(),
];
