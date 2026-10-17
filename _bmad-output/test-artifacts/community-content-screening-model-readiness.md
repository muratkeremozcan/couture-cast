<!-- markdownlint-disable MD013 MD024 -->

# Community content screening: model readiness evidence

Generated: 2026-10-17T16:23:15.130Z by `npm run community:screening:evidence`. Do not edit by hand; this view and the JSON payload come from the same run.

- Payload: `_bmad-output/test-artifacts/community-content-screening-model-readiness.json`
- Payload SHA-256: `973d1eb37fffe60820bbf99669a5252edf6b9b44dfc3b3e25b2326f4e55246fc`
- Verdict: **fail** (pass only when every gate ran against the current inputs from a committed tree and passed; fail when any gate that ran failed; incomplete otherwise)
- Commit: `0cd5f93657b70139de6e89df842f64156681fc41`
- Input-set hash: `b365bbf1c1320a25e5da1c6aa412a4da9db854f782ebc1a6e854565c8c07716f`

This payload authorizes, at most, the Community Beta model-readiness signature. It is not a launch decision. Signing is a separate step: the repository owner runs `npm run community:screening:sign` interactively, or an agent session the owner delegated it to runs `npm run community:screening:sign -- --delegated`, which records only an approval and only of a payload whose verdict is `pass`.

## Gates

| Gate                                                                                                            | Status     | Measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Evidence generated from a committed working tree                                                                | passed     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Worker image builds, verifies the model, and fits the dependency budget                                         | passed     | nodeModulesMb: 112; user: node; entrypoint: ["/usr/bin/tini","-s","--"]; commitSha: 0cd5f93657b70139de6e89df842f64156681fc41                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Canary against the local container                                                                              | passed     | target: local; disposition: pass; engineIdentity: adr013-text:policy-v2@b0daab4ab9d1;adr013-nsfw-v1.0:mobilenet_v2_mid@4.3.0:model-a0c76f72db26:v2:policy-b0daab4ab9d1; processedBy: community-worker@0cd5f93657b70139de6e89df842f64156681fc41; queueLatencyMs: 1; screeningDurationMs: 180; finishedAt: 2026-10-17T15:52:21.217Z                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A job queued while the worker is down completes after it restarts                                               | passed     | mode: restart-drill; observedDowntimeMs: 13196; consumerReturnedAt: 2026-10-17T15:52:35.296Z; queueLatencyMs: 13202; disposition: pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Canary against the deployed worker on the hosted target                                                         | not run    | stale against current inputs: inputs changed since the measurement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Policy-surface sweep: one disposition per vector, no pass at or above any review threshold, full block coverage | passed     | vectors: 10852; byOutcome: {"review:low_confidence":6996,"block:unsafe_class":3594,"pass:none":172,"review:probability_sum_invalid":6,"review:output_invalid":43,"review:class_mismatch":41}; uncoveredBlocks: 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Model and policy chosen on the calibration half, shipped as chosen                                              | passed     | family: mobilenet_v2_mid; variant: safe-mass@0.85; calibrationEntries: 341; calibrationWithheldRate: 0.1672                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Safe photograph withheld rate on the holdout half (Wilson 95% upper bound)                                      | **FAILED** | problems: 7 safe photographs blocked; upper bound 0.128613 above 0.05. evaluated: 298; validationRejected: 0; withheld: 27; rate: 0.0906; wilson95: [0.063015,0.128613]; blocked: 7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Vendored LDNOOBW lists match the pinned commit and every allow-list entry has a reason                          | passed     | status: verified; upstreamCommit: 5faf2ba42d7b1c0977169ec3611df25a3c08eb13; problems: []                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Clean fashion copy withheld rate per language on the frozen holdout (Wilson 95% upper bound)                    | **FAILED** | problems: es: 1 of 420 holdout entries withheld, upper bound 1.34%; fr: 1 of 420 holdout entries withheld, upper bound 1.34%; it: 2 of 420 holdout entries withheld, upper bound 1.72%; pt: 4 of 420 holdout entries withheld, upper bound 2.42%. de: {"holdout":420,"holdoutWithheld":0,"upperBound":0.009063,"inSample":416,"inSampleWithheld":0,"deliberateReview":4}; en: {"holdout":420,"holdoutWithheld":0,"upperBound":0.009063,"inSample":416,"inSampleWithheld":0,"deliberateReview":4}; es: {"holdout":420,"holdoutWithheld":1,"upperBound":0.013362,"inSample":420,"inSampleWithheld":0,"deliberateReview":0}; fr: {"holdout":420,"holdoutWithheld":1,"upperBound":0.013362,"inSample":419,"inSampleWithheld":0,"deliberateReview":1}; it: {"holdout":420,"holdoutWithheld":2,"upperBound":0.017194,"inSample":420,"inSampleWithheld":0,"deliberateReview":0}; pt: {"holdout":420,"holdoutWithheld":4,"upperBound":0.024229,"inSample":420,"inSampleWithheld":0,"deliberateReview":0}; tr: {"holdout":420,"holdoutWithheld":0,"upperBound":0.009063,"inSample":420,"inSampleWithheld":0,"deliberateReview":0} |
| Disguised terms withheld in every obfuscation family                                                            | passed     | de: {"total":100,"bypasses":0}; en: {"total":100,"bypasses":0}; es: {"total":100,"bypasses":0}; fr: {"total":100,"bypasses":0}; it: {"total":100,"bypasses":0}; pt: {"total":100,"bypasses":0}; tr: {"total":100,"bypasses":0}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Pinned model artifacts, WASM binaries and policy hash verified                                                  | passed     | status: verified; failures: []                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Startup and warm inference latency inside the absolute ceilings on the sandbox resource profile                 | passed     | profile: local container, 0.2 vCPU, 512 MiB (Northflank sandbox envelope); cpuLimit: 0.2; memoryLimitMib: 512; warmupSamples: 50; warmSamples: 1000; coldStartupMs: 2697.3; warmP95Ms: 295.6; warmP99Ms: 312.64                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Worker container memory peak while screening the largest accepted upload                                        | passed     | memoryPeakMib: 341.4; memoryLimitMib: 512; upload: generated-4096x4096.jpg; canaryDisposition: pass; processedBy: community-worker@0cd5f93657b70139de6e89df842f64156681fc41; soleConsumerProven: true; consumersBefore: 1; consumersAfter: 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Idle worker plus expected traffic at or below 5 USD a month on Upstash Pay as You Go                            | passed     | idleWorker: community-worker@0cd5f93657b70139de6e89df842f64156681fc41; idleWorkerConnectedSamples: 121 of 121; idleCommandsPerHour: 306; commandsPerPost: 85; projectedMonthly: 481780; idleMonthlyUsd: 0.44676; trafficMonthlyUsd: 0.5168; projectedMonthlyUsd: 0.96356; dailySubmissions: 100; postsPerDayAtCostCeiling: 881                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Both production Community rollout flags remain disabled                                                         | passed     | communityReadEnabled: false; communityWriteEnabled: false; source: packages/config/src/flags.ts defaultValue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Model and policy calibration

Chosen on the 341 calibration photographs only: mobilenet_v2_mid with safe-mass@0.85, withholding 16.7% of them. Selection rule: lowest calibration withheld rate among families that fit 512 MiB peak RSS and the 150 MB node_modules budget; ties to the stricter threshold, then the smaller model. Unsafe bounds held for every variant: Hentai or Porn above 0.35 blocks, Hentai plus Porn must stay below 0.1, Sexy must stay below 0.15, and Hentai, Porn and Sexy together must stay below 0.15.

| Family           | Installed model | node_modules | Peak RSS at 512 MiB | Warm p95 at 0.2 vCPU | Cold start | v1 policy | Best variant   | Best withheld |
| ---------------- | --------------- | ------------ | ------------------- | -------------------- | ---------- | --------- | -------------- | ------------- |
| mobilenet_v2     | 3.6 MB          | 120.4 MB     | 198.1 MiB           | 397.3 ms             | 2289.2 ms  | 69.5%     | safe-mass@0.85 | 40.5%         |
| mobilenet_v2_mid | 5.9 MB          | 112 MB       | 219.2 MiB           | 311.9 ms             | 2280.2 ms  | 91.5%     | safe-mass@0.85 | 16.7%         |
| inception_v3     | 30.0 MB         | 146.8 MB     | 479.4 MiB           | 2088.9 ms            | 7690.7 ms  | 63.9%     | safe-mass@0.85 | 43.1%         |

Every variant for mobilenet_v2_mid on the calibration half:

| Variant        | Pass | Review | Block | Withheld |
| -------------- | ---- | ------ | ----- | -------- |
| current        | 29   | 302    | 10    | 91.5%    |
| safe-mass@0.95 | 241  | 90     | 10    | 29.3%    |
| safe-mass@0.9  | 279  | 52     | 10    | 18.2%    |
| safe-mass@0.85 | 284  | 47     | 10    | 16.7%    |
| safe-mass@0.8  | 284  | 47     | 10    | 16.7%    |
| safe-mass@0.75 | 284  | 47     | 10    | 16.7%    |
| safe-mass@0.7  | 284  | 47     | 10    | 16.7%    |
| safe-mass@0.65 | 284  | 47     | 10    | 16.7%    |
| safe-mass@0.6  | 284  | 47     | 10    | 16.7%    |
| safe-mass@0.55 | 284  | 47     | 10    | 16.7%    |
| safe-mass@0.5  | 284  | 47     | 10    | 16.7%    |

## Safe photograph corpus and projected review load

The corpus holds 640 openly licensed fashion photographs from 199 creators, split by creator (by creator: first hexadecimal digit of the SHA-256 of the creator key (source:creator, lower-cased), even is calibration, odd is holdout) into a calibration half of 342 and a holdout half of 298, with no creator above 5% of the corpus. The 298 holdout photographs, which played no part in choosing the policy, were screened through the production normalization path and screener (0 rejected by validation): 27 were withheld (9.06%, Wilson 95% interval 6.30% to 12.86%), 7 of them blocked. By the bound that withheld them: 7 blocked: an unsafe class above the block floor; 17 unsafe aggregate at or above its ceiling; 3 review class at or above its ceiling.

At 100 submissions a day (assumption: no planning document records an expected Community Beta submission volume; replace with --beta-daily-submissions once the cohort size is known), the image policy alone sends an expected 9.1 and at most 12.9 posts a day to the 2 moderators, 6.4 each at the upper bound.

| Submissions a day | Expected withheld a day | Upper bound a day | Per moderator at upper bound |
| ----------------- | ----------------------- | ----------------- | ---------------------------- |
| 50                | 4.5                     | 6.4               | 3.2                          |
| 100               | 9.1                     | 12.9              | 6.4                          |
| 250               | 22.7                    | 32.2              | 16.1                         |
| 500               | 45.3                    | 64.3              | 32.2                         |
| 1000              | 90.6                    | 128.6             | 64.3                         |

Every withheld or blocked holdout photograph, with what it shows (from `_bmad-output/test-artifacts/community-safe-corpus-holdout-triage.json`). None of the 27 shows nudity or sexual content. The 7 blocked photographs are ordinary fashion, wedding, uniform and doll pictures, so the block floor fires on benign input. Six entries are dolls, a rendered avatar or AI-generated portraits rather than photographs of people, which the Openverse query admitted.

| Photograph                           | Disposition | Bound                                          | Neutral / Drawing / Sexy / Hentai / Porn | What it shows                                                                                                 |
| ------------------------------------ | ----------- | ---------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 01da9472-af82-4def-ace4-8535e794a5ce | block       | blocked: an unsafe class above the block floor | 0.004 / 0.166 / 0.004 / 0.046 / 0.781    | Close-up profile of a woman with pink and blonde hair and a camel coat; head and shoulders, fully clothed.    |
| 01df40b3-9a45-4f25-b38b-b0d9f9c48742 | review      | unsafe aggregate at or above its ceiling       | 0.228 / 0.485 / 0.03 / 0.169 / 0.088     | Woman on a stage in a white tulle ball gown with a sheer high neckline; studio watermark.                     |
| 01f79a05-6f46-4584-bf61-a77b005d969c | review      | unsafe aggregate at or above its ceiling       | 0.035 / 0.315 / 0.221 / 0.295 / 0.134    | Studio shot of a woman in a pink plaid shirt dress, hands on hips.                                            |
| 08cb4351-3f29-4b1b-adc9-436ca4462e96 | review      | unsafe aggregate at or above its ceiling       | 0.514 / 0.231 / 0.067 / 0.033 / 0.156    | Antique sepia cabinet card of a woman in a long Victorian dress.                                              |
| 0b880dc1-c544-4d42-9d8c-89f84f2afc14 | review      | unsafe aggregate at or above its ceiling       | 0.176 / 0.637 / 0.026 / 0.158 / 0.003    | Woman with blonde curls against a graffiti wall in a cropped bandeau top and matching skirt; midriff visible. |
| 1b39c651-f54e-473e-8ed0-5cb7fd391349 | review      | review class at or above its ceiling           | 0.381 / 0.068 / 0.517 / 0.005 / 0.029    | Woman in a polka-dot sundress on a pool lounger beside a cat, holding a glass of wine.                        |
| 1eb897a5-46e6-4e23-847c-3db5c6c0470f | review      | unsafe aggregate at or above its ceiling       | 0.647 / 0.165 / 0.049 / 0.05 / 0.09      | Legs in orange high heels against an adobe wall with a pink skirt hem in frame; no torso.                     |
| 1fc04cd5-60a5-44a0-b927-031ab79e7c2e | review      | unsafe aggregate at or above its ceiling       | 0.452 / 0.22 / 0.176 / 0.044 / 0.107     | Black-and-white wedding photograph of a bride in a strapless gown with pearls and a bouquet.                  |
| 2e5ac408-0b2a-423b-93c9-739db5dcd2e6 | block       | blocked: an unsafe class above the block floor | 0.14 / 0.082 / 0.018 / 0.022 / 0.738     | Close-up of a white naval dress-uniform sleeve with its shoulder tab; sailors blurred behind.                 |
| 377d225b-60d6-4ccb-905e-dc22f07e1537 | block       | blocked: an unsafe class above the block floor | 0.219 / 0.115 / 0.252 / 0.356 / 0.058    | A fashion doll in a striped top and white skirt lying on a wooden floor.                                      |
| 40b7cf60-8240-435d-8bbf-757905dc2f06 | review      | review class at or above its ceiling           | 0.117 / 0.634 / 0.173 / 0.075 / 0.001    | Woman lying on pavement in a white blouse and velvet trousers, hand on her forehead.                          |
| 518ee1d8-a2f8-4d9d-8221-515293f4caf1 | block       | blocked: an unsafe class above the block floor | 0.056 / 0.164 / 0.073 / 0.661 / 0.045    | Smiling woman at an evening event in a black halter bikini-style top and low cargo trousers; bare midriff.    |
| 51f99b8c-8f20-4889-b2c5-8e3bb7d86bc2 | block       | blocked: an unsafe class above the block floor | 0.006 / 0.526 / 0.023 / 0.425 / 0.02     | Same graffiti-wall shoot as 0b880dc1: a woman in a bandeau top and skirt, midriff visible.                    |
| 594a6945-d7e3-4b13-bb0b-552e3acc089c | review      | unsafe aggregate at or above its ceiling       | 0.201 / 0.304 / 0.327 / 0.048 / 0.12     | Woman in an off-the-shoulder floral prairie dress leaning on a stone well at sunset.                          |
| 6f7eeb9d-20ed-4c44-83c9-2ad5a86e7dc8 | review      | review class at or above its ceiling           | 0.262 / 0.023 / 0.629 / 0.006 / 0.08     | Woman on a bridge walkway in a white strapless top, skinny jeans and platform sandals.                        |
| 8043ea7e-aa5b-411f-b36e-776e239d9855 | block       | blocked: an unsafe class above the block floor | 0.143 / 0.19 / 0.068 / 0.044 / 0.555     | Woman in sunglasses and a long fringed ivory boho dress leaning on a white column.                            |
| 8e5c6604-c7d6-4e9e-a486-2a5ca9b468d4 | block       | blocked: an unsafe class above the block floor | 0.123 / 0.321 / 0.14 / 0.375 / 0.041     | Woman in a floral puff-sleeve ruffled gown twirling beside a stone pillar.                                    |
| 94660d67-bbe4-49ec-aaf9-b87972d1eb75 | review      | unsafe aggregate at or above its ceiling       | 0.208 / 0.614 / 0.047 / 0.036 / 0.094    | Older man in Union Jack swim briefs flexing on a beach in front of breaking waves.                            |
| 98cd7877-d6a3-4ed3-b4b6-071685b0dabb | review      | unsafe aggregate at or above its ceiling       | 0.131 / 0.648 / 0.064 / 0.117 / 0.04     | Woman lying on a yellow sofa in a pink camisole slip dress; looks rendered or AI-generated.                   |
| aa1f82b5-6755-4e72-a320-eb6116e5fd6c | review      | unsafe aggregate at or above its ceiling       | 0.181 / 0.466 / 0.012 / 0.04 / 0.301     | Back view of a woman in an off-the-shoulder striped shirt dress on a street; head cropped out.                |
| af260d91-c3cb-4174-b7ef-cdd8fa9c4fec | review      | unsafe aggregate at or above its ceiling       | 0.41 / 0.461 / 0.001 / 0.127 / 0         | Two ball-jointed dolls with red and green hair in knitwear.                                                   |
| b28674a9-3c82-4e9a-a9f8-156e2113e245 | review      | unsafe aggregate at or above its ceiling       | 0.295 / 0.452 / 0.027 / 0.215 / 0.011    | Rendered 3D avatar in a cropped red sweater and plaid mini skirt against a rainbow background.                |
| c272bcc0-aab3-4514-8c66-dd9cc45cef40 | review      | unsafe aggregate at or above its ceiling       | 0.526 / 0.182 / 0.133 / 0.157 / 0.001    | Studio shot of a woman in a plaid sleeveless sheath dress and white sunglasses.                               |
| db9d878d-d918-4cd3-bec8-9cf439acede7 | review      | unsafe aggregate at or above its ceiling       | 0.159 / 0.685 / 0.032 / 0.1 / 0.023      | Smiling woman in a sleeveless brown jumpsuit beside a red scooter on a street.                                |
| dc48ba50-0478-453f-831b-d0f7a92d1491 | review      | unsafe aggregate at or above its ceiling       | 0.644 / 0.199 / 0.013 / 0.1 / 0.043      | Black-and-white street portrait of a woman in a satin camisole; looks AI-generated.                           |
| ddc39919-7768-454a-82bf-4b8c678ede7e | review      | unsafe aggregate at or above its ceiling       | 0.38 / 0.368 / 0.076 / 0.127 / 0.049     | Ball-jointed doll in a white tank top, denim mini skirt and fluffy boots, beside its box.                     |
| e437ea01-74ac-4c05-a7f2-00bca8067dba | review      | unsafe aggregate at or above its ceiling       | 0.095 / 0.713 / 0.006 / 0.009 / 0.177    | Man in a bowler hat, grey overcoat and tie looking down; head and shoulders.                                  |

## Runtime latency and memory

Latency, measured inside the worker image (local container, 0.2 vCPU, 512 MiB (Northflank sandbox envelope)): cold startup 2697.3 ms, warm p50 195.79 ms, p95 295.6 ms, p99 312.64 ms over 1000 samples of a 512x640 JPEG.

Memory, the number the host's out-of-memory killer acts on: the running worker container's cgroup memory.peak was 341.4 MiB of a 512 MiB limit, across startup and the canary screening generated-4096x4096.jpg (5355810 bytes) through the real pipeline. The container's worker was the only consumer on the queue before the job was enqueued and after it completed (Redis client 179 both times).

## Redis cost

The production database is on Upstash Pay as You Go: 0.20 USD per 100K commands, with no free command allowance on a paid plan (https://upstash.com/pricing/redis, read 2026-10-17).

Idle worker: 306 commands an hour (7344 a day), measured over 30 minutes against a local Redis only the worker used. One screened post: 85 commands. At 100 posts a day the projected month is 481,780 commands, 0.96 USD: 223,380 idle (0.45 USD) and 258,400 traffic (0.52 USD). The gate is 5 USD a month; the worker alone stays at or below it up to 881 posts a day and crosses it above that, at this per-post cost. Every command Redis records, including the commands BullMQ Lua scripts run inside EVALSHA. Upstash does not document whether a script counts once or per inner command, so this is the upper bound.

Before tuning, BullMQ's defaults (a 5-second idle block, a 30-second stalled check) measured 6,516 commands an hour idle (2026-10-16T23:09:47.853Z), 9.51 USD a month at this price. The worker now blocks for 300 seconds and checks for stalled jobs every 120 seconds.

The worker uses the production Upstash database the API already uses for its own queues. These figures are the community worker alone; the API’s commands are billed on the same database.

## Text screening

The clean-copy gate runs on the frozen holdout. The in-sample clean half, which the allow list was built against, and the captions carrying a deliberate review term are reported beside it.

| Language | Holdout gated | Holdout withheld | Upper bound | In-sample gated | In-sample withheld | Deliberate review | Disguised cases | Bypasses |
| -------- | ------------- | ---------------- | ----------- | --------------- | ------------------ | ----------------- | --------------- | -------- |
| de       | 420           | 0                | 0.91%       | 416             | 0                  | 4                 | 100             | 0        |
| en       | 420           | 0                | 0.91%       | 416             | 0                  | 4                 | 100             | 0        |
| es       | 420           | 1                | 1.34%       | 420             | 0                  | 0                 | 100             | 0        |
| fr       | 420           | 1                | 1.34%       | 419             | 0                  | 1                 | 100             | 0        |
| it       | 420           | 2                | 1.72%       | 420             | 0                  | 0                 | 100             | 0        |
| pt       | 420           | 4                | 2.42%       | 420             | 0                  | 0                 | 100             | 0        |
| tr       | 420           | 0                | 0.91%       | 420             | 0                  | 0                 | 100             | 0        |

Withheld holdout entries: es-holdout-376, fr-holdout-010, it-holdout-094, it-holdout-320, pt-holdout-186, pt-holdout-206, pt-holdout-238, pt-holdout-410.

## Deployment

- Target: Northflank Developer Sandbox (always-on combined service built from apps/api/Dockerfile.community-worker) (deployed)
- Resource profile: 512 MiB, 1 replica at concurrency 1; 0.2 vCPU is the CPU share the local container emulated; confirm it against the sandbox plan once the service exists
- Fallbacks: Oracle Cloud Always Free (ARM VM); Railway (paid, from 5 USD a month)
- Image: `sha256:f9a2d8c75b54e13acaf3742e4b3633464072b61d5648afce2093f777136a967f` (linux/arm64), commit 0cd5f93657b70139de6e89df842f64156681fc41, node_modules 112 MB of 150 MB

## Findings

### model-labels-real-photographs-as-drawing

On real photographs of people the NSFWJS models put most of their probability on Drawing rather than Neutral, so the v1 confident-Neutral policy withheld almost every ordinary fashion photograph (91.5% of the 341 calibration photographs). The synthetic fabric fixtures Story 6.2 used scored Neutral near 1 and could not show this.

Cross-check: Recorded once, 2026-10-16: 65 corpus photographs were also classified through the upstream nsfwjs.load("MobileNetV2Mid") classify path with the union @tensorflow/tfjs CPU backend, in a throwaway install outside this repository, and 62 of 65 reached the same disposition, so the effect is the model and the policy, not this repository’s preprocessing.

Consequence: Policy v2 was calibrated on the calibration half only: Neutral plus Drawing (NSFWJS’s safe-for-work classes) above a floor, with every unsafe bound, including the joint bound on Hentai, Porn and Sexy, held at its v1 value. The holdout half measures the result, and the gate is computed there.

### holdout-versus-calibration

On the 298 holdout photographs (split by creator) the policy withheld 9.1% (Wilson 95% upper bound 12.9%), against 16.7% on the 341 calibration photographs it was chosen on; 7 holdout photographs were blocked. The gate's ceiling is 5%, so it fails. The commonest cause is unsafe aggregate at or above its ceiling (17 of 27). Every withheld and blocked holdout photograph is listed with what it shows. Closing the gate needs a different model or a decision to loosen an unsafe bound, and neither was taken here.

### text-holdout-versus-tuning-half

The frozen text holdout, written after the allow list froze and never tuned against, withheld clean captions in 4 of 7 languages (es 1 of 420, fr 1 of 420, it 2 of 420, pt 4 of 420; by severity medium 3, high 1, low 4), where the in-sample clean half the allow list was built against withheld 0. The in-sample figure overstated the list quality; the holdout is the honest one. Fixing these means changing the lists or the allow list and then freezing a new holdout, because tuning against this one would turn it into a second tuning set.

### screener-defects-fixed

The sweep, the corpora and the review found 5 defects in the Story 6.2 screening code, each fixed with a regression test: a duplicated class name could overwrite another class’s slot and publish (now class_mismatch); leet classing could create a doubled letter the index had already collapsed, so f r 3 5 s e published; a multi-word term cut at a different place, vai-tefoder, reached no matching pass; one allow-listed word disabled every multi-word term containing it; a re-split multi-word term written in leetspeak (k1ll yours elf) published, because the re-split pass compared plain letters only.

## Limitations

### model-recall-inherited

Recall against real unsafe imagery is inherited from the upstream NSFWJS mobilenet_v2_mid model at nsfwjs@4.3.0 and is not measured in this repository. No unsafe imagery may enter it, so no corpus here establishes that the model emits a high Hentai or Porn probability for genuinely unsafe input.

- Residual risk: An unsafe image that the model reads as safe for work (Drawing plus Neutral above 0.85, Hentai plus Porn below 0.1, Sexy below 0.15, all of them together below 0.15) publishes automatically, and how often that happens has not been measured here. Counting Drawing toward the safe mass, which the calibration chose, widens what publishes compared with the v1 Neutral-only floor; no unsafe bound, joint or single, is looser than v1.
- Mitigation: Automatic publication requires a confident safe-for-work reading with every unsafe bound at its v1 value, and every other outcome routes to a human, so a recall failure on uncertain input becomes review load rather than a published post. The report action (Story 6.4), the moderator queue (Story 6.10) and both rollout flags staying closed until the moderator rota is real cover the confident-miss case.
- Revisit when: A moderator confirms a published post that should have been withheld, the model or its version changes, or the beta cohort grows past what two moderators can watch reactively.

### term-lists-without-native-review

The 7 term lists have pinned, attributable community provenance (LDNOOBW at one commit, CC-BY-4.0) and a repository-graded overlay, but no native-speaker review. LDNOOBW was compiled to keep words out of image-search autocomplete, which is broader than abuse screening, and the lists are uneven: en carries 403 upstream entries and de 66.

- Residual risk: Abuse written with words outside the lists publishes; ordinary words the lists carry route captions to review, and the frozen text holdout measures how often that happens on copy nobody tuned against. Upstream-only entries are graded profanity at medium severity, so none of them blocks on its own.
- Mitigation: Every language runs against every submission, obfuscation families are normalised before matching, mixed scripts route to review, the repository allow list records why each exemption exists, and the clean-copy gate measures the false-positive cost per language on a holdout.
- Revisit when: A native-speaker reviewer is available for any of the seven languages, moderators report a missed term or a recurring false positive, or a new locale is enabled.

### fashion-term-lolita-always-goes-to-review

Fashion term 'lolita' always goes to review. It names a fashion subculture and is also a child-sexualisation keyword, and on a 13+ product the policy keeps it as a deliberate review term rather than allow-listing it. The French 'baiser' is kept the same way: a kiss as a noun, the commonest vulgar verb otherwise.

- Residual risk: Every Lolita-fashion caption and every caption using the French noun waits for a moderator, which delays those members and adds to review load.
- Mitigation: Both are recorded with their reasons in the policy (text.deliberateReviewTerms); startup refuses a policy that allow-lists or drops either; the corpora label the captions carrying them as expected review and report them beside the clean-copy gate; and a moderator clears an ordinary post in one action.
- Revisit when: Moderators find these captions are almost always cleared, or the platform raises its minimum age.

### stock-photography-distribution

The safe corpus is drawn from openly licensed stock and community photography on Openverse, filtered to fashion titles and tags. It may not match the distribution of what members actually upload: phone photos, mirror selfies, low light, partial bodies, swimwear.

- Residual risk: The real review rate on member uploads may be higher than the measured rate, which would raise the moderators’ daily load above the projection.
- Mitigation: The corpus is split by creator and caps any creator at 5% of it, the projection is reported at the Wilson upper bound and across a range of volumes, and the moderator queue shows the actual rate from the first beta day.
- Revisit when: The first two weeks of beta traffic exist: replace the projection with the observed withheld rate and re-measure if it differs from the corpus rate by more than its interval.

### two-moderators

The beta operates with 2 moderators (ADR-013 staffing plan) covering a 24-hour review SLA through rotating shifts.

- Residual risk: A spike in withheld posts, an incident-mode period where every submission routes to review, or one moderator’s absence can breach the SLA.
- Mitigation: Rollout flags open reading and writing separately, the daily posting cap bounds per-account volume, the projected review load is in this payload, and the SLA monitor (Story 6.12) alerts before a breach.
- Revisit when: The projected or observed daily review load exceeds what 2 people can clear inside the 24-hour SLA, or the cohort is widened.

### hosted-measurement-pending

The hosted canary has run; runtime latency and memory are still from the local container under the sandbox resource limits, and the regression gate committed in the model manifest comes from developer hardware.

- Residual risk: The hosted CPU may be slower or noisier than the emulation, and the regression gate does not yet describe production hardware.
- Mitigation: The latency and memory gates run on the emulated profile, the memory gate reads the real container’s cgroup peak at the largest accepted upload, and the hosted canary records real queue latency and screening duration.
- Revisit when: The worker is deployed: run the measurements inside the hosted container and re-baseline the regression gate from them.

### pay-as-you-go-redis-cost

The production Upstash database is on Pay as You Go, which bills every command (0.20 USD per 100K). An idle BullMQ worker polls Redis continuously. With BullMQ defaults it measured 6,516 commands an hour, about 9.51 USD a month while idle; the worker now blocks for 300 seconds between idle polls and checks for stalled jobs every 120 seconds, and the measured idle cost plus projected traffic is in the Redis section. The worker uses the production Upstash database the API already uses for its own queues. These figures are the community worker alone; the API’s commands are billed on the same database.

- Residual risk: The bill grows with every command, the API’s own commands are billed on the same database and are not in this measurement, and a volume past 881 posts a day takes the worker alone past 5 USD a month. A connection that dies silently during a long block delays pickup until the block times out.
- Mitigation: A new job wakes the blocked worker at once, so the long block costs no pickup latency; the outbox dispatcher and the stale-review sweep are the backstops for a dead connection; the deployment guide names the provider dashboard figures to watch after the first day (commands and cost, which count the API and the worker together).
- Revisit when: The Upstash console projects the database past 5 USD for a month, or daily submissions approach 881.

## Rollback

The hosted community worker. The API, web and mobile surfaces are not deployed by this story.

1. Leave community_read_enabled and community_write_enabled disabled; they are disabled now and nothing in this story changes them.
2. Redeploy the previous image on the host (Northflank keeps prior builds per commit), or stop the service. A stopped worker leaves queued jobs in Redis; they run when a worker returns, and the stale-review sweep moves anything pending too long to review_failed.
3. If the model itself is the problem, set COMMUNITY_NSFW_SCREENER=unavailable with COMMUNITY_NSFW_INCIDENT_MODE=unavailable and COMMUNITY_NSFW_INCIDENT_REFERENCE, and restart: every submission routes to human review and nothing auto-publishes.
4. Run the hosted canary after any rollback to confirm the restored worker publishes the safe fixture under a real-model identity, and that the worker name carries the commit you rolled back to.
5. Re-screen posts refused during the incident with the retained-job replay procedure in the deployment guide.

## Community Beta gate signatures

- Closes here: model
- Remain open: moderation staffing, SLA alerts, privacy, deletion, localization, accessibility, rollback
- Rollout: community_read_enabled=false, community_write_enabled=false

A model-readiness signature is not a launch decision. Community Beta opens only when all eight gate signatures are recorded, and the rollout flags stay disabled until then.

## Commands

- buildImage: `npm run community:screening:image:build`
- canaryLocal: `npm run community:screening:canary:local`
- canaryRestartDrill: `npm run community:screening:canary:restart-drill`
- canaryHosted: `npm run community:screening:canary -- --target hosted --env-file <hosted env file> --json-out apps/api/.cache/community-screening/canary-hosted.json`
- measureRuntimeContainer: `npm run community:screening:measure:container`
- measureMemory: `start the worker container fresh under --memory=512m, then npm run community:screening:measure:memory`
- policySweep: `npm run community:screening:sweep`
- textEvaluation: `npm run community:screening:text`
- verifyLists: `npm run verify:community-screening-lists`
- verifyListsRemote: `npm run verify:community-screening-lists -- --remote`
- fetchSafeCorpus: `npm run community:screening:corpus:fetch`
- verifySafeCorpus: `npm run community:screening:corpus:verify`
- evaluateSafeCorpus: `npm run community:screening:corpus:evaluate`
- calibrateModels: `node scripts/calibrate-community-screening-models.mjs --tfjs-from <evaluation install> --measurements apps/api/.cache/community-screening/model-measurements.json`
- measureModelsContainer: `docker run --rm --memory=512m --cpus=0.2 -v $PWD/scripts:/repo/scripts:ro -v <linux evaluation install>:/eval:ro node:24.21.0-bookworm-slim node /repo/scripts/calibrate-community-screening-models.mjs --tfjs-from /eval --measure <family>`
- measureRedis: `npm run community:screening:measure:redis`
- measureRedisPerPost: `node scripts/measure-community-worker-redis.mjs --canary-runs 5 --idle-baseline apps/api/.cache/community-screening/redis-idle.json > apps/api/.cache/community-screening/redis-per-post.json`
- verifyModel: `npm run verify:community-screening-model --workspace api`
- generateEvidence: `npm run community:screening:evidence`
- sign: `npm run community:screening:sign`
- signDelegated: `npm run community:screening:sign -- --delegated`
- verifySignature: `npm run community:screening:verify-signature`
- verifyChanged: `npm run verify:changed`
- validate: `npm run validate`
