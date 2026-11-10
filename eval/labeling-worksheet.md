# Labelling worksheet — questions C-01…C-12 and D-01…D-06

For each question, **tick every merchant whose transactions the question is asking about** (change `[ ]` to `[x]`).
Rules:
- Judge by what the question *means*, not by the category shown. Categories are classifier output and are wrong in places (e.g. `grocery` is filed under Dining).
- A tick counts **every** expense row with that exact merchant text. If one text means two different things, say so in the note line and I will split it.
- Nothing is pre-ticked and the order is alphabetical, not by any retrieval score.
- If a relevant merchant is missing from the list, add its exact text on the "Also include" line (separate several with `;`).
- If a question has nothing relevant at all, leave it unticked and write `none` on the Note line.
- "pooled" lists are not exhaustive (a keyword net I wrote by hand plus the top embedding matches), so recall of gold is bounded by what is shown. "exhaustive" lists show every expense row in the month.

## C-01 · demo · "what did I spend on takeout?"

_pooled — hand-written keyword net (5 merchant texts match; the 5 most frequent shown) ∪ merchants of the top 20 rows by embedding similarity, over 262 expense rows_

- [x] **Chipotle** — 10 rows, ₹187.08; e.g. 2026-05-02 ₹15.19, 2026-05-17 ₹24.59, 2026-05-23 ₹20.12 ⟨00⟩
- [x] **Curry Up Now** — 8 rows, ₹150.18; e.g. 2026-05-10 ₹23.58, 2026-05-20 ₹13.35, 2026-06-02 ₹20.88 ⟨01⟩
- [x] **DoorDash** — 9 rows, ₹365.91; e.g. 2026-06-05 ₹37.85, 2026-06-08 ₹36.36, 2026-06-29 ₹56.06 ⟨02⟩
- [x] **Marufuku Ramen** — 8 rows, ₹151.96; e.g. 2026-06-11 ₹18.73, 2026-07-08 ₹26.99, 2026-07-24 ₹16.98 ⟨03⟩
- [x] **Sweetgreen** — 8 rows, ₹158.13; e.g. 2026-06-26 ₹22.83, 2026-06-28 ₹13.19, 2026-07-11 ₹26.46 ⟨04⟩
- [ ] **Trader Joe's** — 6 rows, ₹359.76; e.g. 2026-05-08 ₹39.07, 2026-05-12 ₹76.55, 2026-05-25 ₹58.71 ⟨05⟩
- [ ] **Whole Foods Market** — 8 rows, ₹613.63; e.g. 2026-05-06 ₹64.7, 2026-05-13 ₹81.45, 2026-07-07 ₹61.57 ⟨06⟩

Also include (exact merchant text, separated by `;`): 
Note: 

## C-02 · demo · "how much did I spend on getting around town?"

_pooled — hand-written keyword net (4 merchant texts match; the 4 most frequent shown) ∪ merchants of the top 20 rows by embedding similarity, over 262 expense rows_

- [x] **BART** — 51 rows, ₹293.45; e.g. 2026-05-01 ₹4.23, 2026-05-07 ₹3.71, 2026-05-11 ₹5.83 ⟨00⟩
- [x] **Chevron** — 7 rows, ₹378.73; e.g. 2026-05-08 ₹44.33, 2026-05-18 ₹59.58, 2026-05-21 ₹50.12 ⟨01⟩
- [x] **Lyft** — 8 rows, ₹162.41; e.g. 2026-05-11 ₹20.16, 2026-05-30 ₹27.39, 2026-06-06 ₹23.64 ⟨02⟩
- [x] **Shell** — 11 rows, ₹608.6; e.g. 2026-05-01 ₹53.19, 2026-05-05 ₹64.73, 2026-05-11 ₹50.99 ⟨03⟩

Also include (exact merchant text, separated by `;`): 
Note: 

## C-03 · demo · "what do I pay for streaming and media?"

_pooled — hand-written keyword net (4 merchant texts match; the 4 most frequent shown) ∪ merchants of the top 20 rows by embedding similarity, over 262 expense rows_

- [x] **Audible** — 4 rows, ₹59.8; e.g. 2026-05-09 ₹14.95, 2026-06-09 ₹14.95, 2026-07-09 ₹14.95 ⟨00⟩
- [ ] **Comcast Xfinity** — 4 rows, ₹319.96; e.g. 2026-05-12 ₹79.99, 2026-06-12 ₹79.99, 2026-07-12 ₹79.99 ⟨01⟩
- [x] **iCloud** — 5 rows, ₹14.95; e.g. 2026-05-05 ₹2.99, 2026-06-05 ₹2.99, 2026-07-05 ₹2.99 ⟨02⟩
- [x] **Netflix** — 5 rows, ₹77.45; e.g. 2026-05-03 ₹15.49, 2026-06-03 ₹15.49, 2026-07-03 ₹15.49 ⟨03⟩
- [x] **Spotify** — 4 rows, ₹47.96; e.g. 2026-05-07 ₹11.99, 2026-06-07 ₹11.99, 2026-07-07 ₹11.99 ⟨04⟩
- [ ] **Ticketmaster** — 8 rows, ₹173.04; e.g. 2026-05-24 ₹28.38, 2026-06-07 ₹19.89, 2026-06-08 ₹17.49 ⟨05⟩

Also include (exact merchant text, separated by `;`): 
Note: Comcast is a utility; Ticketmaster is event ticketing, not streaming/media.

## C-04 · demo · "how much goes on gym and fitness?"

_pooled — hand-written keyword net (2 merchant texts match; the 2 most frequent shown) ∪ merchants of the top 20 rows by embedding similarity, over 262 expense rows_

- [ ] **CVS Pharmacy** — 2 rows, ₹35.98; e.g. 2026-07-10 ₹16.02, 2026-07-13 ₹19.96 ⟨00⟩
- [ ] **Netflix** — 5 rows, ₹77.45; e.g. 2026-05-03 ₹15.49, 2026-06-03 ₹15.49, 2026-07-03 ₹15.49 ⟨01⟩
- [x] **Planet Fitness** — 5 rows, ₹124.95; e.g. 2026-05-02 ₹24.99, 2026-06-02 ₹24.99, 2026-07-02 ₹24.99 ⟨02⟩
- [ ] **REI** — 2 rows, ₹140.81; e.g. 2026-07-03 ₹62.95, 2026-07-20 ₹77.86 ⟨03⟩
- [ ] **Target** — 5 rows, ₹266.75; e.g. 2026-05-16 ₹69.84, 2026-06-28 ₹27.1, 2026-07-17 ₹49.42 ⟨04⟩
- [ ] **Walgreens** — 4 rows, ₹129.71; e.g. 2026-06-28 ₹25.34, 2026-08-12 ₹39.3, 2026-08-20 ₹38.81 ⟨05⟩
- [ ] **Whole Foods Market** — 8 rows, ₹613.63; e.g. 2026-05-06 ₹64.7, 2026-05-13 ₹81.45, 2026-07-07 ₹61.57 ⟨06⟩

Also include (exact merchant text, separated by `;`): 
Note: REI is a general outdoor retailer — unticked.

## C-05 · demo · "what are my medical and pharmacy costs?"

_pooled — hand-written keyword net (3 merchant texts match; the 3 most frequent shown) ∪ merchants of the top 20 rows by embedding similarity, over 262 expense rows_

- [x] **CVS Pharmacy** — 2 rows, ₹35.98; e.g. 2026-07-10 ₹16.02, 2026-07-13 ₹19.96 ⟨00⟩
- [x] **Kaiser Permanente** — 5 rows, ₹175.87; e.g. 2026-05-04 ₹23.34, 2026-06-02 ₹40.79, 2026-06-20 ₹40 ⟨01⟩
- [ ] **Planet Fitness** — 5 rows, ₹124.95; e.g. 2026-05-02 ₹24.99, 2026-06-02 ₹24.99, 2026-07-02 ₹24.99 ⟨02⟩
- [ ] **Safeway** — 8 rows, ₹491.64; e.g. 2026-05-07 ₹40.11, 2026-05-14 ₹50.79, 2026-06-15 ₹34.19 ⟨03⟩
- [ ] **Trader Joe's** — 6 rows, ₹359.76; e.g. 2026-05-08 ₹39.07, 2026-05-12 ₹76.55, 2026-05-25 ₹58.71 ⟨04⟩
- [x] **Walgreens** — 4 rows, ₹129.71; e.g. 2026-06-28 ₹25.34, 2026-08-12 ₹39.3, 2026-08-20 ₹38.81 ⟨05⟩
- [ ] **Whole Foods Market** — 8 rows, ₹613.63; e.g. 2026-05-06 ₹64.7, 2026-05-13 ₹81.45, 2026-07-07 ₹61.57 ⟨06⟩

Also include (exact merchant text, separated by `;`): 
Note: 

## C-06 · demo · "how much did I spend on coffee shop visits?"

_pooled — hand-written keyword net (3 merchant texts match; the 3 most frequent shown) ∪ merchants of the top 20 rows by embedding similarity, over 262 expense rows_

- [x] **Blue Bottle Coffee** — 7 rows, ₹43.99; e.g. 2026-07-06 ₹9.2, 2026-07-09 ₹6.47, 2026-07-12 ₹5.77 ⟨00⟩
- [x] **Philz Coffee** — 13 rows, ₹96.36; e.g. 2026-05-01 ₹9.09, 2026-05-26 ₹8.94, 2026-05-28 ₹5.99 ⟨01⟩
- [x] **Tartine Bakery** — 7 rows, ₹115.94; e.g. 2026-05-05 ₹15.26, 2026-05-08 ₹16.64, 2026-06-13 ₹14.96 ⟨02⟩

Also include (exact merchant text, separated by `;`): 
Note: Tartine is a bakery café; ticked as a coffee-shop visit.

## C-07 · real · "what did I spend on chai and snacks?"

_pooled — hand-written keyword net (96 merchant texts match; the 12 most frequent shown) ∪ merchants of the top 8 rows by embedding similarity, over 1996 expense rows_

- [x] **1 Panipuri** — 4 rows, ₹100; e.g. 2016-12-31 ₹25, 2017-11-19 ₹20, 2018-03-18 ₹30 ⟨00⟩
- [x] **2 cutting chai** — 4 rows, ₹80; e.g. 2017-12-17 ₹20, 2018-01-07 ₹20, 2018-04-15 ₹20 ⟨01⟩
- [x] **2 kachori** — 8 rows, ₹192; e.g. 2017-04-25 ₹24, 2017-05-28 ₹24, 2017-06-01 ₹24 ⟨02⟩
- [x] **3 cutting chai** — 1 row, ₹30; e.g. 2018-07-08 ₹30 ⟨03⟩
- [x] **chocobar** — 13 rows, ₹255; e.g. 2016-12-10 ₹30, 2017-04-30 ₹10, 2017-07-11 ₹15 ⟨04⟩
- [x] **cutting chai** — 4 rows, ₹39; e.g. 2018-03-18 ₹10, 2018-07-05 ₹7, 2018-08-05 ₹10 ⟨05⟩
- [x] **Gupta bhel** — 6 rows, ₹150; e.g. 2017-05-23 ₹25, 2017-07-15 ₹25, 2017-09-29 ₹25 ⟨06⟩
- [x] **Khari packet** — 6 rows, ₹270; e.g. 2018-01-29 ₹45, 2018-02-05 ₹45, 2018-02-16 ₹45 ⟨07⟩
- [x] **snacks** — 3 rows, ₹378; e.g. 2015-01-22 ₹33, 2015-02-05 ₹21, 2015-04-18 ₹324 ⟨08⟩
- [x] **tea** — 18 rows, ₹277; e.g. 2015-01-01 ₹10, 2015-01-02 ₹10, 2015-01-04 ₹20 ⟨09⟩
- [x] **Tea** — 24 rows, ₹277; e.g. 2015-02-24 ₹10, 2015-02-26 ₹6, 2015-02-28 ₹20 ⟨10⟩
- [x] **Toast packet** — 5 rows, ₹195; e.g. 2018-04-30 ₹45, 2018-05-09 ₹45, 2018-07-09 ₹20 ⟨11⟩
- [x] **Vadapav** — 7 rows, ₹120; e.g. 2017-06-02 ₹20, 2017-07-09 ₹20, 2017-09-21 ₹15 ⟨12⟩

Also include (exact merchant text, separated by `;`): 
Note: `tea` and `Tea` are separate exact texts — both ticked.

## C-08 · real · "how much did I spend on phone and TV recharges?"

_pooled — hand-written keyword net (21 merchant texts match; the 12 most frequent shown) ∪ merchants of the top 8 rows by embedding similarity, over 1996 expense rows_

- [x] **Annual recharge** — 2 rows, ₹5090; e.g. 2017-07-20 ₹2545, 2018-06-23 ₹2545 ⟨00⟩
- [x] **Current Residence - Tata Play recharge** — 8 rows, ₹1316; e.g. 2017-08-19 ₹217, 2017-09-14 ₹100, 2017-09-28 ₹215 ⟨01⟩
- [x] **Data booster pack** — 14 rows, ₹3260; e.g. 2017-12-25 ₹181, 2017-12-29 ₹181, 2018-05-14 ₹301 ⟨02⟩
- [x] **Family Mobile Service Provider recharge** — 2 rows, ₹5598; e.g. 2016-07-01 ₹2599, 2017-08-04 ₹2999 ⟨03⟩
- [ ] **Internet renewal** — 3 rows, ₹4400; e.g. 2015-01-13 ₹500, 2015-02-08 ₹3400, 2015-02-15 ₹500 ⟨04⟩
- [ ] **internet renewal (3 months pack)** — 2 rows, ₹2900; e.g. 2015-05-14 ₹1450, 2015-08-13 ₹1450 ⟨05⟩
- [x] **mobile recharge sim 2** — 1 row, ₹98; e.g. 2016-11-30 ₹98 ⟨06⟩
- [x] **Mobile Service Provider** — 21 rows, ₹5271; e.g. 2016-03-21 ₹251, 2016-04-02 ₹251, 2016-04-11 ₹251 ⟨07⟩
- [x] **Mobile Service Provider freedom pack** — 5 rows, ₹1480; e.g. 2017-03-10 ₹296, 2017-03-19 ₹296, 2017-10-24 ₹296 ⟨08⟩
- [x] **Mobile Service Provider recharge** — 1 row, ₹149; e.g. 2017-01-21 ₹149 ⟨09⟩
- [x] **Mobile Service Provider recharge 365 days** — 2 rows, ₹5198; e.g. 2015-07-19 ₹2599, 2016-07-20 ₹2599 ⟨10⟩
- [x] **Mobile Service Provider recharge wfh** — 19 rows, ₹5219; e.g. 2015-10-22 ₹251, 2015-11-07 ₹251, 2015-11-21 ₹251 ⟨11⟩
- [x] **Permanent Residence - Tata Play recharge** — 11 rows, ₹1833; e.g. 2017-10-23 ₹191, 2017-11-25 ₹156, 2017-12-25 ₹156 ⟨12⟩
- [x] **Tata Sky** — 5 rows, ₹917; e.g. 2016-12-29 ₹214, 2017-01-23 ₹181, 2017-02-25 ₹100 ⟨13⟩

Also include (exact merchant text, separated by `;`): 
Note: internet renewals unticked (broadband, not phone/TV).

## C-09 · real · "what did I spend on daily milk?"

_pooled — hand-written keyword net (28 merchant texts match; the 12 most frequent shown) ∪ merchants of the top 8 rows by embedding similarity, over 1996 expense rows_

- [x] **1 lit** — 26 rows, ₹1816; e.g. 2017-11-07 ₹70, 2017-11-09 ₹70, 2017-11-16 ₹70 ⟨00⟩
- [x] **1.5 lit milk** — 4 rows, ₹401; e.g. 2017-08-15 ₹99, 2017-08-31 ₹99, 2017-09-17 ₹99 ⟨01⟩
- [x] **1.5 lit milk + 3 cold drink + 1 khari + 1 bread** — 1 row, ₹200; e.g. 2017-03-11 ₹200 ⟨02⟩
- [x] **1lit buffalo milk** — 1 row, ₹70; e.g. 2016-09-09 ₹70 ⟨03⟩
- [x] **Half lit milk** — 31 rows, ₹1088; e.g. 2017-07-15 ₹32, 2017-07-19 ₹32, 2017-07-20 ₹32 ⟨04⟩
- [x] **half liter buffalo** — 7 rows, ₹238; e.g. 2016-09-11 ₹35, 2016-09-12 ₹35, 2017-01-29 ₹35 ⟨05⟩
- [x] **Milk** — 6 rows, ₹163; e.g. 2015-02-26 ₹26, 2015-02-28 ₹26, 2015-03-14 ₹26 ⟨06⟩
- [x] **milk 0.5 lit** — 3 rows, ₹93; e.g. 2017-01-03 ₹31, 2017-01-05 ₹31, 2017-01-06 ₹31 ⟨07⟩
- [x] **milk 1 lit** — 2 rows, ₹120; e.g. 2017-03-25 ₹60, 2017-03-26 ₹60 ⟨08⟩
- [x] **milk 1lit** — 67 rows, ₹4485; e.g. 2015-02-19 ₹60, 2017-03-06 ₹62, 2017-03-07 ₹62 ⟨09⟩
- [x] **milk half gold** — 5 rows, ₹170; e.g. 2015-01-18 ₹29, 2015-01-19 ₹29, 2015-01-21 ₹28 ⟨10⟩
- [x] **milk half shakti** — 15 rows, ₹419; e.g. 2015-01-26 ₹26, 2015-01-29 ₹26, 2015-02-01 ₹26 ⟨11⟩

Also include (exact merchant text, separated by `;`): Half lit Varna milk
Note: mixed row `1.5 lit milk + 3 cold drink + 1 khari + 1 bread` kept (milk is the headline item); `Half lit Varna milk` added via Also include.

## C-10 · real · "how much did I spend on street food and sweets?"

_pooled — hand-written keyword net (75 merchant texts match; the 12 most frequent shown) ∪ merchants of the top 8 rows by embedding similarity, over 1996 expense rows_

- [x] **1 Panipuri** — 4 rows, ₹100; e.g. 2016-12-31 ₹25, 2017-11-19 ₹20, 2018-03-18 ₹30 ⟨00⟩
- [x] **2 kachori** — 8 rows, ₹192; e.g. 2017-04-25 ₹24, 2017-05-28 ₹24, 2017-06-01 ₹24 ⟨01⟩
- [x] **2 sugarcane juice** — 2 rows, ₹80; e.g. 2017-03-12 ₹40, 2018-04-29 ₹40 ⟨02⟩
- [x] **4 kachori** — 2 rows, ₹96; e.g. 2018-05-12 ₹48, 2018-07-15 ₹48 ⟨03⟩
- [x] **Bhaji + vadapav** — 2 rows, ₹70; e.g. 2018-05-03 ₹40, 2018-06-26 ₹30 ⟨04⟩
- [x] **biscuits** — 2 rows, ₹155; e.g. 2016-02-20 ₹85, 2016-02-28 ₹70 ⟨05⟩
- [x] **biscuits+icecream** — 1 row, ₹40; e.g. 2017-01-04 ₹40 ⟨06⟩
- [ ] **flowers (.5kg)+sweets (.25gm+10/-)+vegetables (1.5kg)** — 1 row, ₹310; e.g. 2015-11-14 ₹310 ⟨07⟩
- [x] **Gupta bhel** — 6 rows, ₹150; e.g. 2017-05-23 ₹25, 2017-07-15 ₹25, 2017-09-29 ₹25 ⟨08⟩
- [ ] **Puja saman (150 for 5 Nariyal, 400 for 1kg sweets and 190 fo** — 1 row, ₹740; e.g. 2016-11-19 ₹740 ⟨09⟩
- [ ] **sanitary napkins+chocolates+Maggie+khajoor** — 1 row, ₹504; e.g. 2016-05-29 ₹504 ⟨10⟩
- [x] **Shev bhaji sev pav kg** — 3 rows, ₹180; e.g. 2017-06-19 ₹60, 2017-11-13 ₹60, 2018-07-09 ₹60 ⟨11⟩
- [x] **single pav vada** — 3 rows, ₹35; e.g. 2016-11-17 ₹10, 2017-01-30 ₹15, 2017-02-11 ₹10 ⟨12⟩
- [ ] **snacks + veggie** — 1 row, ₹420; e.g. 2015-04-24 ₹420 ⟨13⟩
- [x] **sugar + biscuits** — 1 row, ₹120; e.g. 2016-10-14 ₹120 ⟨14⟩
- [x] **sugarcane juice** — 6 rows, ₹115; e.g. 2017-04-10 ₹20, 2017-04-22 ₹20, 2017-05-05 ₹20 ⟨15⟩
- [x] **sugarcane juice 2** — 3 rows, ₹90; e.g. 2017-02-19 ₹30, 2017-02-28 ₹30, 2017-03-05 ₹30 ⟨16⟩
- [ ] **toothbrush + biscuits** — 1 row, ₹50; e.g. 2015-04-01 ₹50 ⟨17⟩
- [x] **Vadapav** — 7 rows, ₹120; e.g. 2017-06-02 ₹20, 2017-07-09 ₹20, 2017-09-21 ₹15 ⟨18⟩
- [x] **vanilla ice cream cups 2** — 3 rows, ₹60; e.g. 2016-09-12 ₹20, 2017-03-04 ₹20, 2017-03-07 ₹20 ⟨19⟩

Also include (exact merchant text, separated by `;`): 
Note: mixed rows unticked (whole-row amounts would overstate sweets/street-food spend). `sugar + biscuits` kept (both sweets/snack staples).

## C-11 · real · "what did I spend on doctor and medicine?"

_pooled — hand-written keyword net (26 merchant texts match; the 12 most frequent shown) ∪ merchants of the top 8 rows by embedding similarity, over 1996 expense rows_

- [x] **3 tablet Nor tz** — 1 row, ₹21; e.g. 2017-09-29 ₹21 ⟨00⟩
- [x] **4 paracetamol tablets** — 1 row, ₹10; e.g. 2017-08-01 ₹10 ⟨01⟩
- [x] **adulsa ( tonic for cough )** — 1 row, ₹90; e.g. 2017-01-11 ₹90 ⟨02⟩
- [ ] **auto - GTR to hospital** — 1 row, ₹30; e.g. 2015-01-16 ₹30 ⟨03⟩
- [ ] **auto -hospital to bridge** — 1 row, ₹50; e.g. 2015-01-10 ₹50 ⟨04⟩
- [x] **Cataract Medicine** — 3 rows, ₹2493; e.g. 2018-07-13 ₹1358, 2018-07-20 ₹87, 2018-07-20 ₹1048 ⟨05⟩
- [x] **Doctor Fees** — 5 rows, ₹900; e.g. 2016-12-11 ₹200, 2017-01-01 ₹300, 2017-03-25 ₹150 ⟨06⟩
- [x] **Hospital consultation** — 4 rows, ₹4273; e.g. 2017-07-28 ₹167, 2017-07-28 ₹3050, 2017-07-29 ₹556 ⟨07⟩
- [x] **Medicine** — 7 rows, ₹1836; e.g. 2016-10-09 ₹40, 2016-10-26 ₹617, 2017-09-15 ₹373 ⟨08⟩
- [x] **medicine** — 1 row, ₹700; e.g. 2016-11-03 ₹700 ⟨09⟩
- [x] **painkillers** — 2 rows, ₹308; e.g. 2015-03-02 ₹226, 2015-03-03 ₹82 ⟨10⟩
- [ ] **Permanent Residence to nearby hospital** — 2 rows, ₹80; e.g. 2015-11-03 ₹40, 2016-05-22 ₹40 ⟨11⟩
- [x] **Thyroid Tablets** — 2 rows, ₹912; e.g. 2018-01-13 ₹740, 2018-03-06 ₹172 ⟨12⟩

Also include (exact merchant text, separated by `;`): Tablet; biscuits + medicine
Note: hospital transport rows unticked (travel, not doctor/medicine). `Tablet` and `biscuits + medicine` added via Also include.

## C-12 · real · "how much did I spend on personal grooming?"

_pooled — hand-written keyword net (12 merchant texts match; the 12 most frequent shown) ∪ merchants of the top 8 rows by embedding similarity, over 1996 expense rows_

- [x] **cutting + shaving** — 1 row, ₹80; e.g. 2016-11-02 ₹80 ⟨00⟩
- [x] **Forrest essential after shave** — 1 row, ₹1595; e.g. 2017-06-22 ₹1595 ⟨01⟩
- [x] **grooming** — 1 row, ₹40; e.g. 2015-03-05 ₹40 ⟨02⟩
- [x] **hair cut** — 9 rows, ₹810; e.g. 2015-01-25 ₹60, 2015-10-30 ₹50, 2016-02-28 ₹100 ⟨03⟩
- [x] **hair cut+shaving** — 4 rows, ₹530; e.g. 2016-05-22 ₹120, 2017-01-09 ₹80, 2017-12-03 ₹160 ⟨04⟩
- [x] **hair cut+shaving+dye+facial** — 1 row, ₹2000; e.g. 2015-12-30 ₹2000 ⟨05⟩
- [x] **Himalaya soap(30) + Sofie (59) + kitkat (10)** — 1 row, ₹99; e.g. 2017-01-09 ₹99 ⟨06⟩
- [x] **razor** — 1 row, ₹174; e.g. 2016-10-08 ₹174 ⟨07⟩
- [x] **Razor Blade** — 1 row, ₹247; e.g. 2017-05-16 ₹247 ⟨08⟩
- [x] **shaving** — 1 row, ₹50; e.g. 2015-01-11 ₹50 ⟨09⟩
- [x] **Shaving** — 5 rows, ₹260; e.g. 2017-05-18 ₹50, 2017-06-29 ₹60, 2017-08-21 ₹50 ⟨10⟩
- [ ] **Soap + dahya pav kg** — 1 row, ₹75; e.g. 2018-05-27 ₹75 ⟨11⟩
- [x] **Soap, shampoo, razor** — 1 row, ₹122; e.g. 2018-05-20 ₹122 ⟨12⟩

Also include (exact merchant text, separated by `;`): 
Note: `Soap + dahya pav kg` unticked (mostly food); `shaving`/`Shaving` are separate texts — both ticked. `Himalaya soap(30) + Sofie (59) + kitkat (10)` kept (mostly grooming).

## D-01 · demo · "coffee shops in august"

_pooled — hand-written keyword net (3 merchant texts match; the 3 most frequent shown) ∪ merchants of the top 20 rows by embedding similarity, over 73 expense rows in 2026-08_

- [ ] **Amazon** — 3 rows, ₹203.33; e.g. 2026-08-12 ₹82.4, 2026-08-12 ₹81.6, 2026-08-20 ₹39.33 ⟨00⟩
- [ ] **BART** — 14 rows, ₹82.47; e.g. 2026-08-03 ₹6.79, 2026-08-04 ₹3.79, 2026-08-06 ₹6.74 ⟨01⟩
- [ ] **Best Buy** — 2 rows, ₹100.4; e.g. 2026-08-23 ₹33.37, 2026-08-26 ₹67.03 ⟨02⟩
- [x] **Blue Bottle Coffee** — 4 rows, ₹22.55; e.g. 2026-08-03 ₹5.74, 2026-08-11 ₹5.27, 2026-08-16 ₹4.98 ⟨03⟩
- [x] **Philz Coffee** — 2 rows, ₹12.49; e.g. 2026-08-25 ₹7.12, 2026-08-29 ₹5.37 ⟨04⟩
- [ ] **Sprouts Farmers Market** — 2 rows, ₹136.33; e.g. 2026-08-10 ₹94.05, 2026-08-16 ₹42.28 ⟨05⟩
- [x] **Tartine Bakery** — 2 rows, ₹30.99; e.g. 2026-08-08 ₹16.59, 2026-08-19 ₹14.4 ⟨06⟩

Also include (exact merchant text, separated by `;`): 
Note: Tartine ticked as a bakery café.

## D-02 · demo · "ride sharing and transit in july"

_pooled — hand-written keyword net (2 merchant texts match; the 2 most frequent shown) ∪ merchants of the top 20 rows by embedding similarity, over 67 expense rows in 2026-07_

- [x] **BART** — 13 rows, ₹77.52; e.g. 2026-07-02 ₹3.5, 2026-07-07 ₹7.73, 2026-07-09 ₹3.16 ⟨00⟩
- [x] **Lyft** — 3 rows, ₹50.61; e.g. 2026-07-09 ₹23.13, 2026-07-11 ₹15.48, 2026-07-13 ₹12 ⟨01⟩
- [ ] **Shell** — 3 rows, ₹156.38; e.g. 2026-07-02 ₹62.14, 2026-07-06 ₹45.65, 2026-07-22 ₹48.59 ⟨02⟩
- [ ] **Ticketmaster** — 3 rows, ₹75.61; e.g. 2026-07-16 ₹26.25, 2026-07-20 ₹27.38, 2026-07-24 ₹21.98 ⟨03⟩

Also include (exact merchant text, separated by `;`): 
Note: 

## D-03 · demo · "online shopping in august"

_pooled — hand-written keyword net (2 merchant texts match; the 2 most frequent shown) ∪ merchants of the top 20 rows by embedding similarity, over 73 expense rows in 2026-08_

- [x] **Amazon** — 3 rows, ₹203.33; e.g. 2026-08-12 ₹82.4, 2026-08-12 ₹81.6, 2026-08-20 ₹39.33 ⟨00⟩
- [ ] **BART** — 14 rows, ₹82.47; e.g. 2026-08-03 ₹6.79, 2026-08-04 ₹3.79, 2026-08-06 ₹6.74 ⟨01⟩
- [ ] **Best Buy** — 2 rows, ₹100.4; e.g. 2026-08-23 ₹33.37, 2026-08-26 ₹67.03 ⟨02⟩
- [ ] **Costco Wholesale** — 3 rows, ₹279.88; e.g. 2026-08-04 ₹151.43, 2026-08-07 ₹94.19, 2026-08-22 ₹34.26 ⟨03⟩
- [ ] **DoorDash** — 6 rows, ₹235.64; e.g. 2026-08-05 ₹32.22, 2026-08-07 ₹34.36, 2026-08-12 ₹29.7 ⟨04⟩
- [ ] **iCloud** — 1 row, ₹2.99; e.g. 2026-08-05 ₹2.99 ⟨05⟩
- [ ] **Safeway** — 1 row, ₹72.58; e.g. 2026-08-09 ₹72.58 ⟨06⟩
- [ ] **Sprouts Farmers Market** — 2 rows, ₹136.33; e.g. 2026-08-10 ₹94.05, 2026-08-16 ₹42.28 ⟨07⟩
- [ ] **Ticketmaster** — 2 rows, ₹31.67; e.g. 2026-08-18 ₹15.07, 2026-08-31 ₹16.6 ⟨08⟩

Also include (exact merchant text, separated by `;`): 
Note: Amazon is the only unambiguous online-shopping merchant.

## D-04 · real · "chai and snacks in september"

_exhaustive — every expense row in 2018-09 (24 rows)_

> **Exhaustive for 2018-09.** This list contains every expense row in that month (24 rows), so nothing outside it can be relevant. Check every box carefully: an unticked box means "the question is not asking about this".

- [ ] **1 month subscription** — 1 row, ₹199; e.g. 2018-09-19 ₹199 ⟨00⟩
- [ ] **11 clothes ironing** — 1 row, ₹77; e.g. 2018-09-05 ₹77 ⟨01⟩
- [ ] **1kg atta** — 1 row, ₹46; e.g. 2018-09-13 ₹46 ⟨02⟩
- [x] **2 kachori** — 1 row, ₹24; e.g. 2018-09-05 ₹24 ⟨03⟩
- [ ] **2 Place 0 to Place 3** — 1 row, ₹40; e.g. 2018-09-13 ₹40 ⟨04⟩
- [ ] **2 Place 5 to Place 0** — 1 row, ₹30; e.g. 2018-09-20 ₹30 ⟨05⟩
- [ ] **Amul butter** — 1 row, ₹55; e.g. 2018-09-06 ₹55 ⟨06⟩
- [ ] **Bread** — 1 row, ₹18; e.g. 2018-09-05 ₹18 ⟨07⟩
- [x] **Chinese Bhel** — 1 row, ₹30; e.g. 2018-09-05 ₹30 ⟨08⟩
- [ ] **Data booster pack** — 2 rows, ₹686; e.g. 2018-09-12 ₹667, 2018-09-17 ₹19 ⟨09⟩
- [ ] **Ganesh idol** — 1 row, ₹251; e.g. 2018-09-16 ₹251 ⟨10⟩
- [ ] **Half lit milk** — 4 rows, ₹145; e.g. 2018-09-05 ₹36, 2018-09-07 ₹37, 2018-09-10 ₹36 ⟨11⟩
- [ ] **HBR 2 Months subscription** — 1 row, ₹83; e.g. 2018-09-13 ₹83 ⟨12⟩
- [ ] **Home Food Delivery** — 1 row, ₹650; e.g. 2018-09-11 ₹650 ⟨13⟩
- [ ] **Idli medu Vada mix 2 plates** — 1 row, ₹60; e.g. 2018-09-20 ₹60 ⟨14⟩
- [ ] **Permanent Residence - Tata Play recharge** — 1 row, ₹200; e.g. 2018-09-15 ₹200 ⟨15⟩
- [ ] **Place 2 station to Permanent Residence** — 1 row, ₹50; e.g. 2018-09-14 ₹50 ⟨16⟩
- [ ] **Pocket money** — 2 rows, ₹2040; e.g. 2018-09-03 ₹2000, 2018-09-08 ₹40 ⟨17⟩
- [x] **Shev Puri** — 1 row, ₹40; e.g. 2018-09-05 ₹40 ⟨18⟩

Also include (exact merchant text, separated by `;`): 
Note: no chai rows in 2018-09; only snack items ticked.

## D-05 · real · "daily milk in august"

_exhaustive — every expense row in 2018-08 (56 rows)_

> **Exhaustive for 2018-08.** This list contains every expense row in that month (56 rows), so nothing outside it can be relevant. Check every box carefully: an unticked box means "the question is not asking about this".

- [ ] **1 month subscription** — 1 row, ₹199; e.g. 2018-08-19 ₹199 ⟨00⟩
- [ ] **13 clothes ironing** — 1 row, ₹91; e.g. 2018-08-25 ₹91 ⟨01⟩
- [ ] **2 Place 2 to Place 3 : Sevagram express 3AC** — 1 row, ₹1305.4; e.g. 2018-08-23 ₹1305.4 ⟨02⟩
- [ ] **2 Place 3 to Place 2 : Amritsar express 3AC** — 1 row, ₹1205.4; e.g. 2018-08-23 ₹1205.4 ⟨03⟩
- [ ] **2 plates poha** — 1 row, ₹60; e.g. 2018-08-27 ₹60 ⟨04⟩
- [ ] **5 litres can Distilled water** — 1 row, ₹100; e.g. 2018-08-13 ₹100 ⟨05⟩
- [ ] **8 clothes ironing** — 1 row, ₹56; e.g. 2018-08-14 ₹56 ⟨06⟩
- [ ] **8 kachori** — 1 row, ₹96; e.g. 2018-08-11 ₹96 ⟨07⟩
- [ ] **Baking soda** — 1 row, ₹27; e.g. 2018-08-29 ₹27 ⟨08⟩
- [ ] **Bows** — 1 row, ₹398; e.g. 2018-08-05 ₹398 ⟨09⟩
- [ ] **Brass Puja plate and diva** — 1 row, ₹220; e.g. 2018-08-13 ₹220 ⟨10⟩
- [ ] **Catering Service** — 1 row, ₹60; e.g. 2018-08-23 ₹60 ⟨11⟩
- [ ] **chocobar** — 2 rows, ₹35; e.g. 2018-08-13 ₹20, 2018-08-29 ₹15 ⟨12⟩
- [ ] **Current Residence to Place 0** — 1 row, ₹15; e.g. 2018-08-05 ₹15 ⟨13⟩
- [ ] **cutting chai** — 2 rows, ₹22; e.g. 2018-08-05 ₹10, 2018-08-21 ₹12 ⟨14⟩
- [ ] **Dahi** — 1 row, ₹32; e.g. 2018-08-14 ₹32 ⟨15⟩
- [ ] **Dahi 2 packets** — 2 rows, ₹40; e.g. 2018-08-17 ₹20, 2018-08-27 ₹20 ⟨16⟩
- [ ] **Domino's Pizza** — 1 row, ₹510.85; e.g. 2018-08-31 ₹510.85 ⟨17⟩
- [ ] **eyewear Glasses advance** — 1 row, ₹1000; e.g. 2018-08-02 ₹1000 ⟨18⟩
- [ ] **eyewear Glasses payment remaining** — 1 row, ₹4300; e.g. 2018-08-05 ₹4300 ⟨19⟩
- [ ] **farewell contribution** — 1 row, ₹118; e.g. 2018-08-31 ₹118 ⟨20⟩
- [ ] **For Family** — 1 row, ₹3410; e.g. 2018-08-05 ₹3410 ⟨21⟩
- [ ] **Ganpati+ navratri vargani** — 1 row, ₹1000; e.g. 2018-08-24 ₹1000 ⟨22⟩
- [ ] **hair cut** — 1 row, ₹100; e.g. 2018-08-06 ₹100 ⟨23⟩
- [ ] **Half kg Lahsoon** — 1 row, ₹45; e.g. 2018-08-13 ₹45 ⟨24⟩
- [ ] **Half lit milk** — 7 rows, ₹253; e.g. 2018-08-17 ₹36, 2018-08-21 ₹36, 2018-08-22 ₹37 ⟨25⟩
- [ ] **Home Food Delivery** — 1 row, ₹1120; e.g. 2018-08-24 ₹1120 ⟨26⟩
- [ ] **Khari packet** — 1 row, ₹45; e.g. 2018-08-27 ₹45 ⟨27⟩
- [ ] **M D sure 4kg atta** — 2 rows, ₹432; e.g. 2018-08-02 ₹216, 2018-08-15 ₹216 ⟨28⟩
- [ ] **Permanent Residence - Tata Play recharge** — 1 row, ₹157; e.g. 2018-08-16 ₹157 ⟨29⟩
- [ ] **Place 0 to Place 4 return** — 1 row, ₹20; e.g. 2018-08-05 ₹20 ⟨30⟩
- [ ] **Pocket money** — 6 rows, ₹3205; e.g. 2018-08-01 ₹40, 2018-08-03 ₹2000, 2018-08-05 ₹100 ⟨31⟩
- [ ] **Rajgira ladu** — 1 row, ₹20; e.g. 2018-08-24 ₹20 ⟨32⟩
- [ ] **Supermart** — 3 rows, ₹955; e.g. 2018-08-02 ₹18, 2018-08-13 ₹594, 2018-08-30 ₹343 ⟨33⟩
- [ ] **Toothpaste Patanjali** — 1 row, ₹160; e.g. 2018-08-14 ₹160 ⟨34⟩
- [ ] **Vanila cup** — 1 row, ₹10; e.g. 2018-08-13 ₹10 ⟨35⟩
- [ ] **Vanila family pack** — 1 row, ₹115; e.g. 2018-08-14 ₹115 ⟨36⟩
- [ ] **Warna Srikhand half kg** — 1 row, ₹290; e.g. 2018-08-15 ₹290 ⟨37⟩
- [ ] **Warna Srikhand pav kg** — 1 row, ₹78; e.g. 2018-08-30 ₹78 ⟨38⟩

Also include (exact merchant text, separated by `;`): 
Note: 

## D-06 · real · "doctor and medicine in july"

_pooled — hand-written keyword net (4 merchant texts match; the 4 most frequent shown) ∪ merchants of the top 8 rows by embedding similarity, over 80 expense rows in 2018-07_

- [ ] **Cataract Medicine** — 3 rows, ₹2493; e.g. 2018-07-13 ₹1358, 2018-07-20 ₹87, 2018-07-20 ₹1048 ⟨00⟩
- [ ] **Doctor Fees** — 1 row, ₹100; e.g. 2018-07-04 ₹100 ⟨01⟩
- [ ] **eye drop** — 1 row, ₹153; e.g. 2018-07-08 ₹153 ⟨02⟩
- [ ] **Hospital consultation** — 1 row, ₹500; e.g. 2018-07-08 ₹500 ⟨03⟩
- [ ] **July salary** — 1 row, ₹2000; e.g. 2018-07-31 ₹2000 ⟨04⟩
- [ ] **Medicine** — 1 row, ₹132; e.g. 2018-07-30 ₹132 ⟨05⟩

Also include (exact merchant text, separated by `;`): 
Note: 
