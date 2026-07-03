// The lib/*.mjs modules are plain JS; declare them so `next build` type-checks
// cleanly without hand-writing .d.ts for each. (dev already tolerates this.)
declare module "*.mjs";
