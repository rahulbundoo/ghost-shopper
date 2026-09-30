import type { Locator, Page } from 'playwright';

export interface LocatorStrategy {
  readonly name: string;
  locate(page: Page): Locator;
}
/** Ordered strategies; ambiguity fails closed instead of clicking an arbitrary control. */
export class LocatorResolver {
  async resolve(page: Page, strategies: readonly LocatorStrategy[]): Promise<Locator> {
    for (const strategy of strategies) {
      const candidate = strategy.locate(page).filter({ visible: true });
      const count = await candidate.count();
      if (count === 1) return candidate;
      if (count > 1) throw new Error('AMBIGUOUS_CONTROL');
    }
    throw new Error('CONTROL_NOT_FOUND');
  }
}
export const addToCartStrategies: readonly LocatorStrategy[] = [
  {
    name: 'accessible',
    locate: (page) => page.getByRole('button', { name: /^(add to (cart|bag)|add item)$/i }),
  },
  {
    name: 'shopify-form',
    locate: (page) =>
      page.locator(
        'form[action$="/cart/add"] button[name="add"], form[action$="/cart/add"] input[type="submit"]',
      ),
  },
];
export const checkoutStrategies: readonly LocatorStrategy[] = [
  {
    name: 'accessible-button',
    locate: (page) =>
      page.getByRole('button', { name: /^(check\s?out|proceed to checkout|begin checkout)$/i }),
  },
  {
    name: 'accessible-link',
    locate: (page) => page.getByRole('link', { name: /^(check\s?out|proceed to checkout)$/i }),
  },
  {
    name: 'shopify-cart-form',
    locate: (page) => page.locator('form[action$="/cart"] [name="checkout"]'),
  },
];
