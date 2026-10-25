import { createContext, type ReactNode } from "react";

/**
 * Shows an in-app link (such as a coordinator's `#thread-<id>`) as something
 * of its own. Returning undefined leaves the link as it is.
 */
export type MarkdownLinkRenderer = (
  href: string,
  children: ReactNode,
) => ReactNode | undefined;
export const MarkdownLinkContext = createContext<
  MarkdownLinkRenderer | undefined
>(undefined);
