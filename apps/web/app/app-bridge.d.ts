import type { HTMLAttributes } from 'react';

// App Bridge navigation is not included in Polaris UI component types.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      's-app-nav': HTMLAttributes<HTMLElement>;
    }
  }
}
