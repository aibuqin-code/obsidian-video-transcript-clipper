# Video Transcript Processing Rule v1

This rule defines how an AI should turn a raw transcript exported by this extension into a readable working transcript without fabricating evidence.

## Evidence order

1. The platform subtitle text is the raw evidence.
2. `speaker_mode` is a user-declared context hint, not a platform speaker label.
3. Speaker turns and identities inferred by an AI are provisional unless the text contains an explicit self-introduction, direct form of address, or continuous contextual evidence.
4. The platform description is metadata, never spoken transcript text.

## Speaker handling

- `single`: keep the transcript as a single-speaker text. Do not create speaker labels merely because the speaker quotes another person.
- `two`: infer turns only when the wording supports it. Start with `Speaker A` and `Speaker B`.
- `multi`: use `Speaker A`, `Speaker B`, `Speaker C` and so on. Do not merge speakers to make the conversation cleaner.
- If a turn cannot be assigned, use `Speaker uncertain`.
- Attach a real name only when the transcript itself supports the mapping. Never identify a speaker from guesswork alone.

## Editing

- Preserve the raw source note. Produce a separate processed note or section.
- Repair punctuation, obvious adjacent repetition and paragraph breaks.
- Do not invent omitted words, missing answers or transitions.
- Keep uncertain names, numbers and technical terms visibly uncertain.
- For consequential claims, return to the source video; timestamps help locate evidence but do not prove correctness.

## Natural-language workflow

- “Process/clean this transcript” means: create a separate readable transcript; never overwrite the raw subtitle evidence.
- “Let’s discuss this video” means: use the transcript as conversation context without writing a new note by default.
- “Archive/distill this into my knowledge base” means: create a source-interpretation note that links back to the raw and processed transcripts.
- If the request is ambiguous, ask once whether the user wants a readable transcript, a discussion, or a durable source interpretation.
- If speaker identity matters, show one short representative line for each provisional speaker before asking who A/B/C are. Anonymous labels remain valid when the user does not know.

New exports use `processing_status: pending` and link `[[视频逐字稿处理规则]]`. A successful readable derivative may update only the raw note’s processing metadata and backlink; the raw transcript body remains unchanged.

## Description handling

- `description_quality: platform-native`: the description came from a platform video-detail field. Author-written links to earlier or related videos may remain.
- `description_quality: fallback`: the description came from page metadata and may contain truncation, templates or recommendation pollution.
- Never treat either description as something said in the video.
