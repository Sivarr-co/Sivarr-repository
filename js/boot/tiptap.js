// Tiptap rich-text editor (self-hosted ESM bundle -- keeps CSP tight).
// Collaboration/CollaborationCursor/Y added for Org Docs' live co-editing --
// rebuilt as one bundle (not a second file) so every extension shares the same
// @tiptap/core instance; a duplicate core copy risks subtle breakage in
// Tiptap's extension system. Loaded as <script type="module" src>.
import {
  Editor,
  StarterKit,
  Placeholder,
  Underline,
  Collaboration,
  CollaborationCursor,
  Y,
} from "/static/vendor/tiptap/tiptap.bundle.js";
window._tiptap = {
  Editor,
  StarterKit,
  Placeholder,
  Underline,
  Collaboration,
  CollaborationCursor,
  Y,
};
window.dispatchEvent(new Event("tiptap-ready"));
