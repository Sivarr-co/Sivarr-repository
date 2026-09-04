/**
 * js/core/delegate.js — delegated event listeners replacing inline
 * on*="..." attributes (Session 19, working toward dropping CSP's
 * script-src 'unsafe-inline').
 *
 * WHY NOT eval()/new Function() ON A data-on* STRING
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
 * SUPPORTED ATTRIBUTES
 * --------------------
 *   data-onclick="fn"                    -> fn()
 *   data-onchange / data-oninput / data-onkeydown / data-onkeyup /
 *   data-onblur / data-onfocus / data-onsubmit   -- same grammar as click
 *
 *   Arguments, two forms:
 *     data-onclick-arg0="7" data-onclick-arg1="x"   -> fn("7", "x")
 *         Positional, always STRINGS. Matches what inline onclick="fn('7')"
 *         already gave callers, so no handler signature has to change.
 *
 *     data-onclick-args='["tasks", null, 3]'        -> fn("tasks", null, 3)
 *         JSON array, REAL TYPES. Use this whenever an argument is null,
 *         true/false or a number.
 *
 *         This form exists because of a real trap: ~30 call sites in this
 *         codebase look like onclick="nav('skills', null)". With the
 *         positional form that null becomes the STRING "null", which is
 *         truthy -- so `if (btn)` inside nav() takes the wrong branch and
 *         nothing throws. Exactly the class of silent bug that
 *         `1002 === '1002'` caused in the Home redesign. If an argument is
 *         not a string, it MUST go through data-*-args.
 *
 *   data-onclick-event                   -> the Event is passed FIRST
 *         For onclick="closeDiff(event)" / onkeydown="cmdKey(event)".
 *
 *   data-onclick-this                    -> the element is passed LAST
 *         For onclick="fn(x, this)", where the handler wants the element
 *         (e.g. to toggle an "active" class on it).
 *
 *   data-onclick-self                    -> only fire when the event target
 *         IS this element, not a descendant. Replaces the recurring
 *         onclick="if (event.target === this) closeModal()" backdrop idiom.
 *
 * Order when several are combined: [event?] ...args [element?]
 *
 * Only migrate a handler to this if it dispatches to a real, named global
 * function. Do not add arbitrary-expression support -- that would recreate
 * the problem this file exists to remove.
 */
(function () {
  "use strict";

  // camelCase dataset keys: data-onclick -> onclick, data-onclick-arg0 -> onclickArg0
  function collectArgs(el, type, e) {
    var ds = el.dataset;
    var args = [];

    if (ds["on" + type + "Event"] !== undefined) args.push(e);

    var json = ds["on" + type + "Args"];
    if (json !== undefined) {
      try {
        var parsed = JSON.parse(json);
        args = args.concat(Array.isArray(parsed) ? parsed : [parsed]);
      } catch (err) {
        console.warn('data-on' + type + '-args is not valid JSON: ' + json);
        return null;
      }
    } else {
      for (var i = 0; ds["on" + type + "Arg" + i] !== undefined; i++) {
        args.push(ds["on" + type + "Arg" + i]);
      }
    }

    if (ds["on" + type + "This"] !== undefined) args.push(el);
    return args;
  }

  function makeHandler(type) {
    var attr = "[data-on" + type + "]";
    return function (e) {
      var el = e.target.closest ? e.target.closest(attr) : null;
      if (!el) return;
      // Backdrop idiom: only when the element itself was hit, not a child.
      if (el.dataset["on" + type + "Self"] !== undefined && e.target !== el) return;

      var fnName = el.dataset["on" + type];
      var fn = window[fnName];
      if (typeof fn !== "function") {
        console.warn('data-on' + type + '="' + fnName + '" — no such global function');
        return;
      }
      var args = collectArgs(el, type, e);
      if (args === null) return;   // malformed args JSON, already warned
      fn.apply(null, args);
    };
  }

  // blur/focus do not bubble, so those two listen in the capture phase.
  // mousedown: needed for the rare case a handler must run BEFORE a click
  // would (e.g. preventDefault()-ing a contenteditable's focus loss before
  // it happens) -- click cannot substitute for this, it fires too late.
  var TYPES = [
    ["click", false], ["change", false], ["input", false],
    ["keydown", false], ["keyup", false], ["submit", false],
    ["mousedown", false], ["dblclick", false],
    ["blur", true], ["focus", true],
  ];

  TYPES.forEach(function (pair) {
    document.addEventListener(pair[0], makeHandler(pair[0]), pair[1]);
  });
})();
