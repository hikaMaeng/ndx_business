/**
 * Lets the front-end components load under `node --test`.
 *
 * Vite turns a `.css` import into a side effect it handles itself; Node sees a
 * stylesheet where a module should be and refuses. Mapping those specifiers to
 * an empty module is the whole job — nothing in a test reads the styles, and
 * the alternative is components that cannot be mounted outside a browser.
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith(".css")) {
      return { url: "data:text/javascript,export default {}", shortCircuit: true };
    }
    return next(specifier, context);
  },
});
