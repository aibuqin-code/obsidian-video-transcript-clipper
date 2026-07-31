# Discussion Thread Processing Rule v1

This rule defines how an AI should process a raw discussion thread exported by this extension without flattening disagreement or fabricating context.

## Evidence order

1. Each saved floor is source evidence attributed to the author shown in that floor.
2. A reply link records a structural relationship, not agreement, endorsement or causality.
3. The topic title, category and tags are metadata, not claims made by every participant.
4. Omitted floors remain outside the evidence set even when a saved post replies to them.

## Editing

- Preserve the raw source note. Create a separate readable derivative or interpretation.
- Keep floor numbers, authors and links available in the derivative when claims are discussed.
- Repair presentation only: headings, whitespace and obvious formatting damage.
- Do not merge different authors into one voice.
- Do not invent missing context, deleted content or the substance of an omitted reply target.
- Treat quoted material as a quote until its original source is independently checked.

## Natural-language workflow

- “Process/clean this post” means: create a readable derivative without overwriting the raw discussion.
- “Let's discuss this post” means: use it as conversation context without writing a new note by default.
- “Archive/distill this into my knowledge base” means: create a source-interpretation note linked to the raw discussion.
- If the request is ambiguous, ask once whether the user wants a readable version, a discussion or a durable interpretation.

## Synthesis

- Separate the topic author's position, supporting replies, objections, questions and tangents.
- Attribute each important claim to a floor and author.
- Distinguish consensus from repeated assertions.
- Mark unresolved disputes and missing evidence rather than forcing a conclusion.
- External links, images, code and factual claims should be verified at their source when consequential.

New exports use `processing_status: pending` and link `[[论坛帖子处理规则]]`. Processing may update metadata and backlinks, but the raw floor content remains unchanged.
