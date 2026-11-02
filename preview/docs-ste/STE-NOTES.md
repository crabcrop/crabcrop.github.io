# Docs page in Simplified Technical English: rewrite notes

Preview of: the live `docs.html` rewritten to follow roughly 80% of
ASD-STE100 (Simplified Technical English). The live page is unchanged.
The rewrite changes prose only. Code blocks, URL examples, command
lines, inline code spans, links, all 13 signed image URLs, the
`data-thumbhash` attributes, the thumbhash script, the header, the
logo, and the favicon are byte-identical to the live page. Section
structure and headings are unchanged.

## How the rewrite was built

The page was split into 559 prose units (paragraphs, list items, table
cells). 187 units were rewritten; the rest were already short and
simple, or are labels and values rather than prose. Each rewritten unit
kept its inline code spans as indivisible tokens, so no parameter
name, error code, or example value could drift. A number audit over
all 187 rewritten units found no changed value: every count, limit,
default, and status code from the original is present with the same
value.

## Controlled terms (one term per concept, used everywhere)

| Term | Means | Replaced variants |
| --- | --- | --- |
| source image | the original image a URL works on | the original, the source (for the image), processed source (in most places) |
| source | the last part of the URL, which names the source image | - |
| signed URL | a URL that carries a signature | - |
| signature | the HMAC-SHA256 value in the first path segment | tag (outside the `<key-id>:<tag>` code form) |
| secret | the server secret (CRABCROP_SECRET in code) | - |
| key ID | the optional ID in a signature segment | - |
| remainder | the part of the path after the signature (operations plus source) | the rest of the path |
| operation | one operation segment in the path (for example `300x200`) | directive (for path segments), sizing move |
| filter | one item inside a `filters:` segment | directive (inside filters) |
| preset | a named operation string defined on the server | template |
| source root | a named origin defined on the server | root (alone) |
| output image | the image the server produces | result, render, processed image (in most places) |
| result | one stored output image in a cache tier | render (in cache text) |
| cache entry | one stored item in a cache | stored image, entry |
| meta request / meta response | the JSON metadata form of a URL | meta document |
| standard form | the canonical spelling of a number, path, or URL | canonical form, canonicalized |
| resolved backdrop | the concrete backdrop color after `bg` is resolved (brand, default, hex) | chosen backdrop |
| returns | what the server sends as a response | answers, gets (for responses) |
| fails with | how a request ends in an error | answers (for errors), is a (for error codes) |

## Notable splits

- Focal point paragraph (Crop section): one paragraph of about 340
  words became 33 short sentences. Each rule (bounds, zoom range,
  which crops honor the point, the imgix migration note, `debug:focal`)
  now stands alone.
- Explain report paragraph: one 75-word sentence that listed the whole
  report became 10 sentences, one report part per sentence.
- Crop align sentence (Size and crop): the 78-word sentence, the
  longest on the page, became 13 sentences.
- Bucket rules (Sources and safety): the 64-word S3 naming sentence
  became a rule per sentence (length, character set, start and end,
  dots, hyphens, IP spelling).
- quality(auto) verification: the encode, decode, score, adjust,
  report loop was one sentence; it is now one step per sentence.
- Studio (scene): subject choice, tie breaks, the crop window, and
  the two correction steps were one paragraph of long sentences; each
  rule now stands alone.
- Studio (product): the pipeline already read as a list inside one
  sentence. The rewrite numbers the five steps. The content is the
  same list.

## Kept as-is, on purpose

- Headings. They are structure, and several double as link targets in
  the nav. The body follows STE; the headings keep the site's style.
- Table label cells (filter names, parameter forms, defaults) and the
  demo readouts and operation strings under the AI demos. These are
  labels and syntax, not prose. Three demo paragraphs carry JavaScript
  hooks (ids `szNote`, `fmNote`, and the size builder readout), and
  the URL anatomy definition box (`anaDef`) is filled by the page
  script from strings inside that script. All were left byte-identical
  so the demos behave exactly as on the live page, and so the box
  shows the same text before and after a click. The anatomy box text
  is short and plain in the original, so nothing is lost there. The
  static demo notes (the "honest" notes) were rewritten.
- The footer signoff. It is brand voice, not documentation.
- The test-vector paragraph keeps its telegram style ("Secret X,
  message Y, gives HMAC-SHA256 Z") because the values are code and the
  pattern is the content.

## Points that resist plain words

- "Resolved backdrop" stays. The `bg` argument resolves through brand
  color and a default before a pixel is painted; a simpler word loses
  which color won.
- "Decontaminate" stays in the studio pipeline. It is the precise
  term for removing the old background color from subject edges; a
  plain paraphrase needs a full clause and is still less exact.
- "Age out" stays in key rotation ("until the URLs under the old key
  age out"). No equally short plain phrase carries "stop being used
  over time."
- "Bearer URL" stays. It is the standard security term: the holder of
  the URL can use it, with no other proof.
- "Indistinguishable" became "look the same" and "you cannot tell
  them apart." The meaning is the same; the single crisp word is gone.
  This is the clearest precision-for-simplicity trade on the page.
- "Canonical" became "standard" throughout (standard form, standard
  spelling). Consistent and simpler, but a reader of the spec will
  notice the term change.
- Percentile and histogram language in studio scene mode stays
  technical (0.5th and 99.5th percentiles). The facts are numeric;
  plainer words would change them.

## The one analogy

STE allows a natural tone but the brief allowed at most one analogy.
The rewrite uses exactly one, in Presets: a preset is like a contact
in a phone (you use the name; the server uses the full operation
string). Every other "like" on the page is a factual comparison, not
an analogy.

## Where this lands against STE100

Followed: sentences under 20 words (the longest sentence on the
rewritten page is 20 words; the original had 124 sentences over 25),
active voice as the default (passive constructions in the prose fall
from about 17% of sentences to about 1% in the rewritten units), one
idea per sentence, one term per concept, simple common words, and no
synonyms for variety.

Not followed, deliberately: full STE also restricts the dictionary
itself and bans many common constructions. Technical terms that the
docs cannot lose (signature, preset, silhouette, percentile) stay,
because the brief fixes the target at roughly 80% and forbids losing
facts. Noun clusters remain inside grammar forms and parameter cells,
where the text is syntax rather than prose.
