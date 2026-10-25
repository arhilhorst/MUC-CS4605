/* =====================================================================
 *  Group 18 — vibrotactile bearing display
 *  Replication of Dobbelstein, Henzler & Rukzio, CHI EA 2016
 *
 *  Four coin ERM tactors around the wrist encode the bearing to a
 *  target. Six 60-degree sectors; stimulus DURATION carries the
 *  angular offset. The board plays a pattern locally on command and
 *  reports the microsecond timestamp of the first drive edge, so
 *  onset jitter is measured rather than assumed.
 *
 *  PIN MAP
 *        pin 11  [ LT ]   [ RT ]  pin 10
 *        pin  6  [ LB ]   [ RB ]  pin  9
 *
 *  SERIAL  115200 baud, newline terminated
 *    host -> board      board -> host
 *    ---------------    -------------------------------------------
 *    P,<angle>          START,<angle>,<micros>
 *                       END,<angle>,<micros>
 *    T,<ch>,<ms>        ACK,T,<ch>,<ms>      ch: 0=LT 1=RT 2=LB 3=RB
 *    D,<0-255>          ACK,D,<duty>         set drive level live
 *    S                  ACK,S                all off
 *    ?                  INFO,<duty>,<kick>,<pulse>,<gap>,<count>
 *
 *  Angles are degrees in [-180, 180]. 0 = target straight ahead,
 *  positive = target to the RIGHT.
 * ===================================================================== */

const uint8_t PIN_LT = 11;   // left-top      Timer2A
const uint8_t PIN_RT = 10;   // right-top     Timer1B
const uint8_t PIN_LB =  6;   // left-bottom   Timer0A   <-- see note
const uint8_t PIN_RB =  9;   // right-bottom  Timer1A

const uint8_t PINS[4] = { PIN_LT, PIN_RT, PIN_LB, PIN_RB };

const uint8_t M_LT = 1 << 0;
const uint8_t M_RT = 1 << 1;
const uint8_t M_LB = 1 << 2;
const uint8_t M_RB = 1 << 3;

/* ---------------------------------------------------------------------
 *  NOTE ON PIN 6
 *
 *  Pins 9, 10 (Timer1) and 11 (Timer2) are set to ~31.4 kHz below,
 *  which is above hearing. Pin 6 is on Timer0, which also runs
 *  millis(), micros() and delay() — raising its prescaler would
 *  corrupt every stimulus duration in this file, so it is left at the
 *  Arduino default of 976 Hz.
 *
 *  At DRIVE_DUTY = 255 this does not matter: the pin is simply held
 *  high and all four tactors behave identically. The moment you lower
 *  DRIVE_DUTY to calibrate, LB will whine audibly at 976 Hz while the
 *  other three stay silent — an acoustic cue straight into a study
 *  that masks motor noise on purpose.
 *
 *  FIX, one line: move LB from pin 6 to pin 3 (Timer2B, pairs with
 *  pin 11). Then all four sit on Timer1 and Timer2 at 31.4 kHz.
 *  Change PIN_LB above and the matching entry in web/protocol.js.
 * ------------------------------------------------------------------- */

/* =====================================================================
 *  CALIBRATION PARAMETERS
 *  The paper reports none of these. Ours to choose in pilot testing,
 *  then FREEZE — the "chosen by us, then frozen" list in the proposal.
 *  Record the final values in the analysis plan before the first
 *  formal session. Use D,<duty> to sweep drive level while piloting.
 * ===================================================================== */
uint8_t DRIVE_DUTY = 255;           // hold level 0-255; 255 = full 3.0 V
const uint16_t KICK_MS     = 30;    // full-power kick to beat stiction
const uint16_t PULSE_MS    = 180;   // one pulse in a 3-pulse pattern
const uint16_t GAP_MS      = 120;   // silence between those pulses
const uint8_t  PULSE_COUNT = 3;     // the paper's "arbitrary" three

/* ---- encoding constants, FROM the paper — do not tune ------------- */
const uint16_t DUR_AT_30    = 500;   // ms at 30 degrees off
const uint16_t DUR_AT_90    = 2000;  // ms at 90 degrees off
const uint16_t EXTRA_AT_150 = 2000;  // extra ms once the second tactor joins

/* ---- drive --------------------------------------------------------- */

void setMask(uint8_t mask, uint8_t duty) {
  if (mask & M_LT) analogWrite(PIN_LT, duty);
  if (mask & M_RT) analogWrite(PIN_RT, duty);
  if (mask & M_LB) analogWrite(PIN_LB, duty);
  if (mask & M_RB) analogWrite(PIN_RB, duty);
}

void allOff() {
  for (uint8_t i = 0; i < 4; i++) analogWrite(PINS[i], 0);
}

/* Kick the whole mask together. Kicking per-motor would stagger their
   onsets by KICK_MS, and the front and behind patterns depend on a
   pair being felt as simultaneous. */
void kickOn(uint8_t mask) {
  setMask(mask, 255);
  delay(KICK_MS);
  setMask(mask, DRIVE_DUTY);
}

void pulse(uint8_t mask, uint16_t ms) {
  if (ms <= KICK_MS) { setMask(mask, 255); delay(ms); allOff(); return; }
  kickOn(mask);
  delay(ms - KICK_MS);
  allOff();
}

int normalize(int a) {
  while (a >  180) a -= 360;
  while (a < -180) a += 360;
  return a;
}

/* ---- the encoding ---------------------------------------------------
 *   |a| <=  30   ahead        both top tactors, PULSE_COUNT pulses
 *   |a| <=  90   drifting     one top tactor, 500 .. 2000 ms
 *   |a| <= 150   passed it    top 2 s, then top + bottom together
 *   |a| >  150   behind       both bottom tactors, PULSE_COUNT pulses
 * ------------------------------------------------------------------- */
void playAngle(int angleIn) {
  const int  a     = normalize(angleIn);
  const int  m     = abs(a);
  const bool right = (a > 0);

  if (m <= 30) {
    Serial.print(F("START,")); Serial.print(a); Serial.print(','); Serial.println(micros());
    for (uint8_t i = 0; i < PULSE_COUNT; i++) {
      pulse(M_LT | M_RT, PULSE_MS);
      if (i < PULSE_COUNT - 1) delay(GAP_MS);
    }

  } else if (m <= 90) {
    const uint16_t d = DUR_AT_30 +
        (uint16_t)(((uint32_t)(m - 30) * (DUR_AT_90 - DUR_AT_30)) / 60);
    Serial.print(F("START,")); Serial.print(a); Serial.print(','); Serial.println(micros());
    pulse(right ? M_RT : M_LT, d);

  } else if (m <= 150) {
    const uint8_t  top    = right ? M_RT : M_LT;
    const uint8_t  bottom = right ? M_RB : M_LB;
    const uint16_t extra  = (uint16_t)(((uint32_t)(m - 90) * EXTRA_AT_150) / 60);
    Serial.print(F("START,")); Serial.print(a); Serial.print(','); Serial.println(micros());
    kickOn(top);
    delay(DUR_AT_90 - KICK_MS);
    if (extra > 0) {
      kickOn(top | bottom);
      delay(extra > KICK_MS ? extra - KICK_MS : 0);
    }
    allOff();

  } else {
    Serial.print(F("START,")); Serial.print(a); Serial.print(','); Serial.println(micros());
    for (uint8_t i = 0; i < PULSE_COUNT; i++) {
      pulse(M_LB | M_RB, PULSE_MS);
      if (i < PULSE_COUNT - 1) delay(GAP_MS);
    }
  }

  allOff();
  Serial.print(F("END,")); Serial.print(a); Serial.print(','); Serial.println(micros());
}

/* ---- serial -------------------------------------------------------- */

char buf[32];
uint8_t len = 0;

void handle(char *line) {
  switch (line[0]) {

    case 'P': {                                      // P,<angle>
      char *c = strchr(line, ',');
      if (!c) { Serial.println(F("ERR,P")); return; }
      playAngle(atoi(c + 1));
      break;
    }

    case 'T': {                                      // T,<ch>,<ms>
      char *c1 = strchr(line, ',');
      char *c2 = c1 ? strchr(c1 + 1, ',') : NULL;
      if (!c1 || !c2) { Serial.println(F("ERR,T")); return; }
      int ch = atoi(c1 + 1), ms = atoi(c2 + 1);
      if (ch < 0 || ch > 3) { Serial.println(F("ERR,CH")); return; }
      Serial.print(F("ACK,T,")); Serial.print(ch); Serial.print(','); Serial.println(ms);
      pulse(1 << ch, ms);
      break;
    }

    case 'D': {                                      // D,<0-255>
      char *c = strchr(line, ',');
      if (!c) { Serial.println(F("ERR,D")); return; }
      DRIVE_DUTY = (uint8_t)constrain(atoi(c + 1), 0, 255);
      Serial.print(F("ACK,D,")); Serial.println(DRIVE_DUTY);
      break;
    }

    case 'S':
      allOff();
      Serial.println(F("ACK,S"));
      break;

    case '?':
      Serial.print(F("INFO,"));
      Serial.print(DRIVE_DUTY);  Serial.print(',');
      Serial.print(KICK_MS);     Serial.print(',');
      Serial.print(PULSE_MS);    Serial.print(',');
      Serial.print(GAP_MS);      Serial.print(',');
      Serial.println(PULSE_COUNT);
      break;

    default:
      Serial.println(F("ERR,CMD"));
  }
}

void setup() {
  for (uint8_t i = 0; i < 4; i++) { pinMode(PINS[i], OUTPUT); analogWrite(PINS[i], 0); }

  // ~31.4 kHz on Timer1 (9, 10) and Timer2 (11, 3). Timer0 untouched.
  TCCR1B = (TCCR1B & 0b11111000) | 0x01;
  TCCR2B = (TCCR2B & 0b11111000) | 0x01;

  Serial.begin(115200);
  while (!Serial) { ; }
  Serial.println(F("READY"));
}

void loop() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (len) { buf[len] = '\0'; handle(buf); len = 0; }
    } else if (len < sizeof(buf) - 1) {
      buf[len++] = ch;
    }
  }
}
