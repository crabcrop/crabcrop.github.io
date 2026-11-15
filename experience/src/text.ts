/**
 * Code as HTML that wraps only after a slash, a colon or a comma, never in
 * the middle of a word: a URL or a filter breaks between its parts.
 */
export const soft = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([/:,])(?=[^/\s])/g, '$1<wbr>');
