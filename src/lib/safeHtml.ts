/**
 * The allowlist SafeEmailHtml hands to the browser's Sanitizer API (`Element.setHTML`). Elements not listed are removed
 * WITH their text, so every structural / text element an email may use is either kept or unwrapped
 * (`replaceWithChildrenElements`: the tag goes, its text stays). No attribute but href survives, and images are never
 * listed (so no pixel can load). Pure: covered by npm run check:opens.
 */
export const EMAIL_SANITIZER = {
  elements: ["p", "div", "br", "span", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li", "blockquote", "table", "tbody", "tr", "td", "th"],
  attributes: ["href"],
  replaceWithChildrenElements: [
    "font",
    "center",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "thead",
    "tfoot",
    "caption",
    "section",
    "article",
    "header",
    "footer",
    "main",
    "pre",
    "code",
    "small",
    "sup",
    "sub",
    "s",
    "strike",
    "dl",
    "dt",
    "dd",
    "address",
  ],
};
