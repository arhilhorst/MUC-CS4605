# Tactor Band — Group 18

Replication of the seated perceptual study in **Dobbelstein, Henzler & Rukzio,
"Unconstrained Pedestrian Navigation based on Vibro-tactile Feedback around the
Wristband of a Smartwatch", CHI EA 2016, 2439–2445.**

Four coin ERM tactors around the wrist encode the bearing to a target. Six
60° sectors; the *duration* of the stimulus carries the angular offset. This
repo holds the firmware that plays the patterns and the browser app that runs
sessions, collects responses and reports against the original's claims.

CS 4605, Fall 2026 · Ava Wandersleben, Annarose Hilhorst

---

## What's here

```
firmware/tactor_band/tactor_band.ino   Uno sketch — plays patterns, timestamps onsets
web/index.html                         session UI
web/style.css
web/protocol.js                        encoding mirror + Web Serial transport
web/sequences.js                       trial sequences and the seeded shuffle
web/report.js                          statistics, bootstrap CIs, CSV
data/                                  exported sessions (git-ignored)
```

## Hardware

```
        pin 11  [ LT ]   [ RT ]  pin 10
        pin  6  [ LB ]   [ RB ]  pin  9
```

Each tactor sits behind a 2N3904 switching the low side, driven from its pin
through a 1 kΩ base resistor, with a 1N4148 across the motor (band to +3.0 V)
and a 0.1 µF across it for brush noise. Motors run from an MCP1700-3002
regulator off the Uno's 5 V pin, not off a GPIO — they pull about 85 mA each,
and an Uno pin dies above 40 mA.

### Known issue: pin 6

Pins 9, 10 (Timer1) and 11 (Timer2) are re-prescaled to ~31.4 kHz, above
hearing. **Pin 6 is on Timer0**, which also runs `millis()` and `delay()`, so
its prescaler is left alone and it idles at the Arduino default of 976 Hz.

At `DRIVE_DUTY = 255` this does not matter — the pin is simply held high and
all four tactors behave identically. The moment the drive level is lowered for
calibration, LB will whine at 976 Hz while the other three stay silent, which
is an audible cue in a study that masks motor noise on purpose.

**Fix before pilot calibration:** move LB from pin 6 to **pin 3** (Timer2B,
pairs with pin 11). Change `PIN_LB` in the sketch and the matching entry in
`web/protocol.js`.

## Running a session

1. Flash `firmware/tactor_band/tactor_band.ino` to the Uno.
2. Serve the web app — Web Serial will not attach from a `file://` page:

   ```
   cd web && python3 -m http.server 8000
   ```

3. Open <http://localhost:8000> in **Chrome or Edge**. Firefox and Safari do
   not implement Web Serial.
4. Connect board → enter participant ID → pick a sequence → build → run.
5. Export CSV from the Report tab into `data/`.

## Sequences

| key | angles | source |
|---|---|---|
| `training` | 0, 30, 90, 150, 180, −150, −90, −30 | the paper's familiarisation set, "2–3 times in a row" |
| `test` | 0, ±40, ±70, ±100, ±140, 180 | the paper's test set, "one time each"; we run 3 reps |
| `sweep` | 0, 60, 120, 180, −120, −60 | ours — one angle per sector, pre-session smoke test |
| `boundary` | sector edges ±5° | ours — pilot diagnostic, analyse separately |
| `custom` | whatever you type | ad hoc |

Trial order is shuffled from a seed derived from `participantID|sequence|reps`,
so the order is randomised, reproducible and logged in every row. Each
repetition is shuffled independently and an angle never repeats across a
repetition boundary.

## The encoding

Taken from the paper; **do not tune these.**

| offset | pattern |
|---|---|
| ≤ 30° | both top tactors, 3 pulses |
| 30–90° | one top tactor, duration linear 500 → 2000 ms |
| 90–150° | top tactor 2000 ms, then the bottom one joins for up to 2000 ms more |
| > 150° | both bottom tactors, 3 pulses |

Angles are degrees in [−180, 180]; 0 is straight ahead, positive is to the
right.

## Calibration parameters

The paper reports none of these, so they are ours to choose in pilot testing
and then freeze. They live in one block at the top of the sketch.

| constant | default | what it is |
|---|---|---|
| `DRIVE_DUTY` | 255 | hold level 0–255 after the kick |
| `KICK_MS` | 30 | full-power kick to beat stiction |
| `PULSE_MS` | 180 | one pulse inside a 3-pulse pattern |
| `GAP_MS` | 120 | silence between those pulses |
| `PULSE_COUNT` | 3 | the paper's "arbitrary number of three" |

**Record the frozen values in the analysis plan before the first formal
session**, and commit that file before any data is collected.

## Serial protocol

115200 baud, newline terminated.

| host → board | board → host |
|---|---|
| `P,<angle>` | `START,<angle>,<micros>` then `END,<angle>,<micros>` |
| `T,<ch>,<ms>` | `ACK,T,<ch>,<ms>` — ch 0=LT 1=RT 2=LB 3=RB |
| `D,<0-255>` | `ACK,D,<duty>` |
| `S` | `ACK,S` |
| `?` | `INFO,<duty>,<kick>,<pulse>,<gap>,<count>` |

The board plays patterns from its own timer and reports the microsecond
timestamp of the first drive edge, so onset jitter is measured rather than
assumed. The Report tab shows mean, sd, p95 and max against the proposal's
20 ms gate.

## Data dictionary

One row per trial in the exported CSV.

| column | meaning |
|---|---|
| `participant`, `session_id`, `sequence` | who, which run, which sequence |
| `block_feedback` | 1 if the participant saw the answer after each trial |
| `trial`, `rep` | index within the session, repetition number |
| `true_angle`, `true_sector` | what was played |
| `response_angle`, `response_sector` | where they clicked |
| `signed_error`, `abs_error` | response − true, wrapped to [−180, 180] |
| `sector_correct`, `within10`, `within20` | the C1/C2/C3 indicators |
| `replays` | times the participant asked to feel it again |
| `cmd_sent_ms`, `stim_start_us`, `stim_end_us` | raw timing |
| `onset_latency_ms` | command sent → first drive edge, host-side |
| `stim_duration_ms` | board's own measure of pattern length |
| `rt_ms` | stimulus end → click |
| `iso_time`, `order_seed`, `drive_duty` | provenance |

## Claims under test

| id | claim | original |
|---|---|---|
| C1 | correct sector identified | 97.5% |
| C2 | angle judged within ±10° | 72% |
| C3 | angle judged within ±20° | 88% |
| C4 | top sectors under-estimated, bottom over-estimated | pattern |

The Report tab shows each with a percentile bootstrap CI and whether the
interval contains the original's value. **That readout is indicative only** —
the preregistered classification happens in the analysis notebook against the
margin fixed in the analysis plan. Sector identification is a weak test:
chance alone is 16.7%.

## Working on this together

`protocol.js`, `sequences.js`, `report.js` and `app.js` are separate on
purpose so two people can work without colliding. If you change the pin map or
the encoding, change it in **both** the sketch and `protocol.js` — they mirror
each other and nothing enforces it.

Exported data in `data/` is git-ignored. Decide before the first session
whether participant data goes in the repo at all.
