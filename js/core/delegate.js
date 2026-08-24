/**
 * js/core/delegate.js — one delegated click listener replacing inline
 * onclick="..." attributes (Session 19, working toward dropping CSP's
 * script-src 'unsafe-inline').
 *
 * WHY NOT eval()/new Function() ON A data-onclick STRING
 * --------------------------------------------------------
 * That would satisfy the letter of "no inline onclick=" while keeping the
 * exact security hole unsafe-inline exists to close: an XSS that can inject
 * an attribute could inject data-onclick="fetch(...)" just as easily as
 * onclick="fetch(...)", and unsafe-inline governs inline script/attribute
 * *execution*, not eval() (that's unsafe-eval, a separate directive) -- so
 * removing unsafe-inline while eval-ing an attribute string would change
 * nothing real. This dispatches to actual global functions by name and
 * calls them with real arguments, the same as a normal addEventListener
 * call site would -- no string ever becomes code.
 *
 * USAGE
 * -----
 *   <button data-onclick="habitAdd">+ Add habit</button>
 *       -> habitAdd()
 *
 *   <button data-onclick="load" data-onclick-arg0="7">7 days</button>
 *       -> load("7")
 *
 *   <button class="period-btn" data-onclick="load" data-onclick-arg0="7"
 *           data-onclick-this>7 days</button>
 *       -> load("7", <the button element>)   -- for the onclick="fn(x, this)"
 *          pattern, where the handler wants the clicked element itself
 *          (e.g. to toggle an "active" class on it).
 *
 * Args are always strings (HTML attributes can't carry real types) --
 * exactly what an inline onclick="fn('7')" literal already gave callers,
 * so no handler signature needs to change to adopt this.
 *
 * Only migrate a handler to this if it's a real, named global function.
 * Do not add new inline-style capability here (e.g. no arbitrary
 * expression support) -- that would recreate the problem this exists to
 * remove.
 */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-onclick]");
  if (!el) return;
  const fnName = el.dataset.onclick;
  const fn = window[fnName];
  if (typeof fn !== "function") {
    console.warn(`data-onclick="${fnName}" — no such global function`);
    return;
  }
  const args = [];
  for (let i = 0; el.dataset[`onclickArg${i}`] !== undefined; i++) {
    args.push(el.dataset[`onclickArg${i}`]);
  }
  if (el.dataset.onclickThis !== undefined) args.push(el);
  fn(...args);
});
