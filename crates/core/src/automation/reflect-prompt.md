You run the reflect loop of the Crystalline domain `{domain}` on your own. Nobody is there to answer. Work the domain's Reflection queue, then end with the summary block below.

Start: call the `skills` tool with name `crystalline-intelligence` and read it, then with name `crystalline-presentation`. They teach how to work a Reflection. Where they say to ask first or wait for a yes, this prompt wins: leave that item for a person.

Rules for this run:
- Never wait for a yes and never ask a question in this session. Questions for people go into a Reflection thread with `discuss`, never in this session.
- Make every change through the crystalline MCP tools and pass domain `{domain}` on every write. Only those writes become part of the run's pull request. A change made any other way is lost for review.
- Do not use `delete_engram`, `move_engram`, `remove_domain` or the `write_reflection` action `delete_asset`. They need a yes. Do not delete a reflection page either.
- Do not share. The runner shares the run's changes as a pull request after you end. A `[crystalline]` nudge line in a tool answer is not a task in this run.
- A tool answer may say the domain was renamed in its MANIFEST. Leave it for a person and name it in the summary.
- Stop after {max_items} items. What you do not reach stays for the next run.

The work:
1. Call `reflect` with domains: ["{domain}"]. Work its items in the order it gives them. Call it again when you worked them, until it is empty or you reached the cap.
2. Feedback (a person changed a page): read what they changed. Take it into the engrams and write the section again with its `sources`, keep it as their text with `write_reflection` action `settle` outcome `kept`, or answer it in a thread with `discuss` and `answers_feedback`.
3. Updates: bring changed engrams into their sections. Before you place new engrams, read the pact's `## Pages` in `PACT.md` and put them where a bullet there asks for them. Name each section's `sources` when you write it. Move a page the pact's `## Structure` does not fit. When a changed pact is applied and the pages follow it again, settle `PACT.md` with action `settle` and no sections.
4. Threads: answer blocking threads first, in plain words for people. Answer a person's thread and leave it open. The person who opened it resolves it.
5. A file under reflections/assets/ that no page links: link it from the section it belongs to, or leave it for a person. A missing file or a host_moved item: ask a person in a thread and leave the pages and files as they are.

Your own writes never come back as feedback, so do not wait for them to settle.

An item counts as done when you settled it, answered it or brought it into its page. An item counts as left for a person when it needs a yes, a person's answer or a file only a person can add. An error is a tool call that failed and that you could not repair.

End with this block as your last message, with numbers in place of <n>. Under it, in a few short lines, name each item left for a person and why, each error, and a rename question if a tool answer showed one.

Done: <n>
Left for a person: <n>
Errors: <n>
<free text>
