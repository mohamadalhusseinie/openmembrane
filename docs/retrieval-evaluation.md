# Retrieval evaluation v1

This fixture was specified before the retrieval change in #144. Its executable counterpart is `tests/retrievalEvaluation.test.ts`. It tests the local retrieval operations (`getRelevantContext` and `searchMemory`) against both JSON and SQLite stores, with no network or model calls. All saved positive examples are active, approved memories; pending examples remain in the candidate queue and the rejected example is removed from it, none ever entering the memory store.

## Corpus and ground truth

Project `project-a` contains 36 newer active workspace notes plus the older `rule_workspace_protocol` (37 eligible workspace matches, before other corpus entries). The notes mention *workspace* but not *pnpm* or *protocol*. The old rule says “Use pnpm workspace protocol for internal packages.” Its timestamp is older than every note. Additional independent entries exercise exact rules, backend observability metadata, conflicting package-manager rules, supersession and project isolation. `project-b` has a matching rule which must not leak into `project-a`.

Each query below has a **fixed** expected relevant ID set, independent of the retrieval implementation. Results outside that set are false positives. `get_relevant_context` supports a scope filter; `search_memory` additionally supports type and tag filters. Both request `limit: 10`.

| Case | Query / filter | Expected relevant IDs | Before-change threshold (Recall@10) | After-change threshold (Recall@10) |
| --- | --- | --- | ---: | ---: |
| exact | `vitest unit tests` | `rule_vitest` | 1 | 1 |
| old-workspace | `pnpm workspace protocol` | `rule_workspace_protocol` | 0 (diagnostic) | 1 |
| synonym | `credentials commits` | `rule_no_secrets` | 0 (diagnostic lexical miss) | 0 (lexical-only; revisit in #97) |
| scope | `trace correlation`, scope `backend` | `rule_backend_trace` | 1 | 1 |
| type | `trace correlation`, type `security_rule` (search only) | `rule_backend_trace` | 1 | 1 |
| tag | `trace correlation`, tag `observability` (search only) | `rule_backend_trace` | 1 | 1 |
| conflict | `dependency installs` | `rule_npm`, `rule_pnpm` | 1 | 1 |
| superseded-negative | `mocha runner` | none | empty | empty |
| project-negative | `project-b-exclusive` in `project-a` | none | empty | empty |

The synonym target contains “Never check secrets into git” and no query tokens; its metadata likewise has no overlapping tokens. This is a deliberate semantic failure, **not** a requirement to enable embeddings. Pending candidates and a rejected candidate use the exact-rule query; none may appear. A superseded memory and another-project memory must never appear even when their text matches. The conflict pair must retain mutual `alternative` annotations in context and the pending count must remain 2; search returns entries without annotations.

Recall@10 = relevant IDs returned in the first ten / relevant IDs in ground truth. Top-10 precision = relevant IDs returned in the first ten / **10** (fixed denominator, even with fewer than ten returned). Macro averages include only the seven positive cases for search and the five context-compatible positive cases (exact, old-workspace, synonym, scope, conflict); negative cases are tested separately. Target after-change recall is 1 for every lexical-positive case, including old-workspace; exact and filtered cases must not regress. The synonym miss remains explicitly measured rather than silently changing the local-only scope. For the dense query, target precision is at least 0.1. No hard latency threshold: compare observed latency to baseline under the same machine, runtime and corpus, since wall-clock timing is environment dependent.

## Recorded runs

Run `npm test -- tests/retrievalEvaluation.test.ts` on the current revision to print one `RETRIEVAL_EVAL_V1` JSON record per backend and operation. The setup writes test data under the current worktree and removes it afterward. Latency is measured with `performance.now()` around each operation after seeding, five sequential invocations per query; records report median milliseconds per query and overall median (not seeding time). Keep the exact runtime and machine when comparing timings; numbers are descriptive, not a CI performance gate.

| Backend / operation | Baseline revision | Baseline macro Recall@10 | Baseline macro precision@10 | Baseline median query latency (ms) | After revision | After Recall@10 | After precision@10 | After median latency (ms) |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| JSON / context | `676e0c1` (old retrieval) | 0.600 | 0.080 | 25.816 | working tree (#144) | 0.800 | 0.100 | 25.830 |
| JSON / search | `676e0c1` (old retrieval) | 0.714 | 0.086 | 31.766 | working tree (#144) | 0.857 | 0.100 | 25.017 |
| SQLite / context | `676e0c1` (old retrieval) | 0.600 | 0.080 | 0.754 | working tree (#144) | 0.800 | 0.100 | 0.507 |
| SQLite / search | `676e0c1` (old retrieval) | 0.714 | 0.086 | 0.535 | working tree (#144) | 0.857 | 0.100 | 0.304 |

Baseline and after-change runs were measured on Windows x64, Node v22.18.0. Both backends gave old-workspace Recall@10 = 0 before and 1 after; synonym Recall@10 remains 0 for both operations, identifying the lexical miss deferred to #97. Exact, filtered and conflict cases each scored 1 in both runs. Latencies are observations from these runs, not portable guarantees.
