# K-Roof 물리 모델 (PHYS)

`js/physics/sun.js` · `thermal.js` · `wind.js` — pure JS, three.js 없음. 검증: `node tests/physics.test.mjs`.
모든 값은 **설계안 상대비교용 추정치**이며, 설계 옵션 문서에 없는 계수는 가정값이다.

---

## 1. 태양 · 기상 (`sun.js`)

### 1.1 태양 위치 — NOAA *General Solar Position Calculations*
분수년 γ = 2π/365 · (n − 1 + (h − 12)/24)

* 균시차 EoT [min] = 229.18 (0.000075 + 0.001868 cos γ − 0.032077 sin γ − 0.014615 cos 2γ − 0.040849 sin 2γ)
* 적위 δ = 0.006918 − 0.399912 cos γ + 0.070257 sin γ − 0.006758 cos 2γ + 0.000907 sin 2γ − 0.002697 cos 3γ + 0.00148 sin 3γ
* 진태양시 TST = 60h + EoT + 4·lon − 60·tz, 시간각 H = TST/4 − 180°
* cos θz = sin φ sin δ + cos φ cos δ cos H, 고도 = 90° − θz + 대기굴절(NOAA 근사)
* 방위각(북=0°, 시계방향) = 180° + atan2(sin H, cos H sin φ − tan δ cos φ)
* 장면 방향(태양 쪽 단위벡터) **dir = (cosEl·sinAz, sinEl, −cosEl·cosAz)** (+x 동, +y 위, +z 남)
* 일출·일몰: cos H₀ = cos 90.833° /(cos φ cos δ) − tan φ tan δ, 남중 = (720 − 4·lon − EoT)/60 + tz (3회 반복)

검증(서울): 하지 남중고도 75.89°, 7/25 남중 12:39 KST · 방위 180.0°, 일출 05:29 (하지 05:11).

### 1.2 청천 일사 — Hottel (1976) + Liu & Jordan (1960)
* τb = a₀ + a₁ exp(−k·m), 가시거리 23 km, 해발 A = 0.05 km:
  a₀* = 0.4237 − 0.00821(6 − A)², a₁* = 0.5055 + 0.00595(6.5 − A)², k* = 0.2711 + 0.01858(2.5 − A)²,
  기후보정 (r₀, r₁, r_k) 중위도 여름 (0.97, 0.99, 1.02) ↔ 겨울 (1.03, 1.01, 1.00)을 계절로 보간
* 공기질량 m: Kasten & Young (1989) — 수평선 근처에서도 유한
* τd = 0.271 − 0.294 τb, G_on = 1367 (1 + 0.033 cos(2πn/365))
* DNI₀ = G_on τb, DHI₀ = G_on sin El · τd, GHI₀ = DNI₀ sin El + DHI₀
* **청명도 c**: GHI = c·GHI₀, DNI = c²·DNI₀, DHI = GHI − DNI sin El (연무·구름은 직달을 먼저 줄이고 일부는 확산으로 전환)

서울 7/25 청천 GHI 최대 898 W/m² (c = 0.95: 854).

### 1.3 외기 · 하늘 온도
* 외기: 05:30 최저, 15:00 최고. 상승 9.5 h / 하강 14.5 h 두 개의 반 코사인 → 극값에서 기울기 0 (C¹ 연속, 비대칭).
* `skyTemperature(Ta)` = Swinbank (1963) T_sky = 0.0552·Ta^1.5 [K]; `skyTemperature(Ta, Tdp)` = Berdahl & Martin (1984)
  ε_sky = 0.711 + 0.56(Tdp/100) + 0.73(Tdp/100)², T_sky = ε^¼·Ta.
* `simulateDay` 내부: Berdahl–Martin, 이슬점 Tdp ≈ Tmin − 1 °C (습윤 기후의 FAO-56 근사),
  구름·연무 보정 ε = ε_clear + (1 − ε_clear)(1 − c).

---

## 2. 열 해석 (`thermal.js`) — 집중정수 RC 회로망

### 2.1 절점과 풀이
| 절점 | 의미 | 열용량 |
|---|---|---|
| T_s | 차열층(골판/패널/차광망) | `thermal.arealHeatCap` × 차열층 면적 A_s = cf·6·3 |
| T_rS | 지붕 강판 중 **직달을 100 % 받는** 요소 | C_r = ρc·t(강판) + ½ 단열재 = 4.33 + 0.75 kJ/m²K (50 mm) |
| T_rH | 지붕 강판 중 **직달이 0 %인** 요소 | C_r |
| T_g | 공기층 공기 | 없음(준정상) |
| T_in | 실내 공기 + 내장·집기 | 500 kJ/K |

* 가열 지붕판 = 상부 각관 안쪽 `CONTAINER.roofRect` 5.8×2.8 = 16.24 m² (각관 100 mm 가 판 가장자리를 낮은 해로부터 가림).
* 면적평균 지붕 **T_roof = T_rH + bt·(T_rS − T_rH)**, bt = 면적평균 직달 투과율(shadeProfile.beamTrans).
  히트맵의 셀별 T = T_rH + trans·(T_rS − T_rH) 와 같은 선형 보간 — 두 절점은 “완전 일사/완전 그늘” 기준 상태.
* 후진 오일러(무조건 안정), Δt = 60 s, 복사·대류 계수는 한 스텝 지연 선형화 h_rad = σ(T₁² + T₂²)(T₁ + T₂).
  5×5 선형계를 부분 피벗 가우스 소거로 매 스텝 풀이. 150 J/m²K 차광망처럼 시정수 수 초인 절점도 자동으로 준정상 처리.
  2일 예열 후 3일째(주기 정상 상태)를 0.25 h 간격으로 출력. Δt 30 s ↔ 300 s 결과 차 < 0.05 K.

### 2.2 지붕 요소 k ∈ {S, H} (m²당)
C_r dT_k/dt = α_r (I_b,k + I_d) + ε_r h_rad(T_side)·SV_side (T_side − T_k) + ε_r h_rad·SV_net (T_sky − T_k)
             + ε_eff h_rad·F_rs φ (T_s − T_k) + h_c,k (T_g − T_k) + U_in (T_in − T_k) ± G_lat (T_S − T_H)

* I_b,S = DNI·sin El (H는 0), I_d = SV·DHI (등방 확산)
* 조망: 지붕→차열층 형태계수 F_rs, 불투명 비율 φ (고체 1, 망 1 − τ), 측면 개구 SV_side = 1 − F_rs, 망 개구 SV_net = F_rs·τ,
  SV = SV_side + SV_net = 1 − F_rs φ. 측면 개구로 보이는 것은 수평선 근처 하늘·주변이므로 T_side = Ta − (Ta − T_sky)·SV_side
  (완전 개방 SV_side = 1 이면 T_sky, 좁은 틈이면 ≈ Ta).
* ε_eff = 1 / (1/ε_bottom + 1/ε_r − 1): 은박 ε 0.05 ↔ 지붕 0.9 → **0.049** (도장면 0.9 이면 0.82). 은박 하면이 지붕 최고온도를
  약 5.5 K 낮춘다(C: 35.1 vs 40.6 °C).
* 내부 전열 U_in = 1 / (t_ins / k_ins + 0.13), k_ins = 0.035 → 50 mm: 0.64 W/m²K (0 mm: 실내 표면저항만 7.7 W/m²K).
* 무대책: F_rs = 0, SV = 1, T_g = Ta, 자유류 대류.
* **채널형(B·C·E) 일사 요소**: 8~15 cm 틈에서 직달이 닿는 곳은 패널 가장자리/바깥뿐이므로 T_rS 는 노출 지붕으로 취급
  (전천 하늘, 자유류 대류, 공기층·차열층과 결합 없음).
* **판내 전도**(고체 차열층): 일사 띠 폭 w_s = bt·A_r/(L_r + W_r), 그늘판은 핀 길이 λ = √(k t / h)(k t = 50·0.0012 W/K)
  → G_lat = k t / (w_s (λ + w_s/3)) [일사면 m²당], 그늘면 m²당 G_lat·bt/(1 − bt) (에너지 보존). 좁은 띠의 과열을 억제.

### 2.3 대류
* 지붕 높이 풍속 U = V₁₀ (3/10)^0.25 = 0.74 V₁₀
* 강제대류 h_f = 2.8 + 3.0 U (Watmuff 1977, Duffie & Beckman) — 복사는 별도 계산하므로 McAdams 5.7 + 3.8V 대신 대류 전용식 사용
* 자연대류(수평면): 불안정(뜨거운 면 위향) 1.52 ΔT^⅓, 안정 0.7 ΔT^¼; 혼합 h = (h_f³ + h_n³)^⅓
* 개방형 캐노피 아래 풍속 = 0.6 U (고체), 0.85 U (망)
* 차광망 가닥(폭 4 mm): Hilpert 원기둥 Nu = 0.683 Re^0.466 Pr^⅓ + Churchill–Chu 자연대류, 양면 젖음면적 2φ

### 2.4 차열층 (W, 면적 A_s)
C_s dT_s/dt = A_s α_abs φ (DNI sin El + DHI) + A_s ε_top φ h_rad (T_sky − T_s) + A_s h_top (Ta − T_s)
            + A_r ε_eff h_rad F_rs φ Σ w_k (T_k − T_s) + (A_s − A_r F_rs) φ ε_bot h_rad (Ta − T_s)
            + A_ov h_bot (T_g − T_s) + (A_s − A_ov) h_bot,out (Ta − T_s)

* w_S = bt, w_H = 1 − bt; A_ov = 지붕판 위 차열층 면적.
* 고체: α_abs = α_top (백색 0.25). **망**: 차광률 등급 = 총 일사투과율이므로 τ = 1 − shade, 가로챈 (1 − τ)를 흡수:반사 = α_top : ρ_solar
  (0.15 : 0.65) 로 분배 → 가닥 흡수율 0.1875, 전방산란 없음. 장파도 개구율 τ 만큼 통과.

### 2.5 공기층
* **개방형(A·D, 0.5~1 m)**: T_g = Ta, 유속 = 캐노피 아래 풍속.
* **채널형(B·C·E)**: 폭 방향 유로 L_ch = 3 m, D_h = 2g.
  구동압 ΔP = ΔC_p·½ρU² (ΔC_p = 0.3) + ρ g β (T_g − Ta)(0.5 g + 0.03 m 지붕 구배)
  ΔP = (K + f L_ch/D_h)·½ρV², f = max(96/Re, 0.316 Re^−0.25) → V = min(V_lam, V_turb)
  K = 1.5 (입·출구) + n_row·β_b/(1 − β_b)², β_b = h_obs/g (지지재 막힘비)

  | 설계 | 막힘 요소 | h_obs | n_row |
  |---|---|---|---|
  | B | Al 레일 40×40 | 0.040 | 2 |
  | C | 크로스바 φ48.6 | 0.0486 | 1.5 |
  | E | 절곡 다리 | 0.030 | 1 |

  h_ch = Nu·k/D_h: 층류 입구영역 Nu = 4.86 + 0.03 Gz/(1 + 0.016 Gz^⅔) (Gz = Re Pr D_h/L, 한쪽 가열 평행평판),
  난류 Gnielinski × (1 + (D_h/L)^⅔); 각 면은 자연대류와 혼합.
  공기 에너지: 0 = Σ h(T_surf − T_g) + H_v (Ta − T_g), H_v = (ρ c_p V g / L_ch)·φ(N),
  N = Σh·L_ch/(ρ c_p V g), φ(N) = (1 − e^−N)/(1 − (1 − e^−N)/N) — **평균 공기온도**로 쓴 정확한 지수 가열식(N→0 에서 2).
* 결과(B, 차광 동일): g 5→9 cm 에서 지붕 최고 −1.6 K, 9→15 cm 에서 −0.4 K (체감 수익, 8~10 cm 이후 평탄).
  기본 그림자 기하에서는 틈이 클수록 낮은 해가 가장자리로 더 들어와 9~15 cm 구간이 ±0.1 K 로 평탄 → 문서의 “8~10 cm 최적”과 일치.

### 2.6 그늘 프로파일
* `shadeProfile(h) → {beamTrans, skyView}` 가 있으면 0.25 h 간격(97회)으로 샘플해 보간, skyView 평균으로 F_rs = (1 − SV)/φ.
* 없으면 기본 기하: 캐노피 = 균일 돌출 (L + 2o)(W + 2o) = cf·18 m² (E 는 `layout` 4×1.4 × 5×0.6), 높이 g,
  그림자 이동 (−g·dir.x/dir.y, −g·dir.z/dir.y) 과 지붕판의 겹침 → bt = 1 − f_cov(1 − τ);
  F_rs = 임의 위치 평행 사각형 형태계수(Gross, Spindler & Hahne 1981, 16항 폐형식; 테스트에서 폐형식과 일치 확인).

### 2.7 실내
C_in dT_in/dt = A_r U_in Σ w_k (T_k − T_in) + UA_wall (T_sa − T_in) + (UA_win + UA_floor + ṁc_p,inf)(Ta − T_in) + Q_sol,win + Q_int − Q_ac

| 항목 | 값 |
|---|---|
| 벽 | U 0.60, 면적 = 외곽 둘레 × 2.6 m − 창, 면별 솔에어 T_sa = Ta + α_w I_v / h_o (α_w 0.5, h_o 17) — 모든 설계 동일 |
| 수직면 일사 I_v | DNI·cosEl·max(0, cos(Az − ψ)) + ½DHI + ½·0.2·GHI (N/E/S/W 면별) |
| 창 | 2.4 m² (남·북 1.2 m²씩), U 4.5, SHGC 0.45 |
| 바닥 | U 0.5 → Ta (들린 바닥 아래 공기) |
| 침기 | 0.8 회/h × 16.24 × 2.35 m³ |
| 내부발열 | 슬라이더 값, 24시간 일정 |
| 에어컨 | 자유부유 해가 설정온도 초과 시 T_in = 설정온도로 고정하고 실내 행의 잔차 = 현열 냉방부하, 전력 = 부하/COP 3.0 |

### 2.8 출력
`hours` 0…24 (0.25 h), 각 시계열 97개. `qRoof = U_in (T_roof − T_in)` [W/m²], `qRoofW = qRoof·A_r`.
`summary.roofHeatKWh` = ∫max(qRoofW, 0) dt (지붕 **유입**열), `coolingKWh` = ∫Q_ac dt, `acKWh = coolingKWh/COP`.
추가 필드(계약 외, 선택): `beamTrans[]`, `summary.TroofSunMax`, `summary.gapVelocityMean`, `meta`.

### 2.9 기준 사례 결과 (서울 7/25, 35/26 °C, 1.5 m/s, c 0.95, α 0.7, 단열 50 mm, 기본 기하)
| 설계 | 지붕 최고 °C | 차열층 °C | 실내 최고(AC off) | 지붕유입 kWh/일 | AC kWh/일 | 저감 % |
|---|---|---|---|---|---|---|
| 0 | 70.8 | — | 50.9 | 3.99 | 7.58 | — |
| A | 40.8 | 43.6 | 46.5 | 1.67 | 6.85 | 58 |
| B | 36.2 | 45.2 | 46.4 | 1.12 | 6.66 | 72 |
| C | 35.1 | 45.4 | 46.3 | 1.04 | 6.64 | 74 |
| D | 45.1 | 36.3 | 47.5 | 2.18 | 7.02 | 45 |
| E | 38.2 | 45.3 | 46.6 | 1.35 | 6.74 | 66 |

해석: 은박 하면(ε 0.05) + 환기 채널이면 지붕판은 공기층 공기(Ta + 0~2 K)를 따라가므로 B·C는 35~36 °C (목표 가이드 38~48 °C 보다 낮음 —
하면 방사율이 먼지·산화로 0.25가 되면 38 °C). D는 직달 20 % + 측면 개방으로 지붕유입 저감 45 %.
실내 최고온도는 벽·창·내부발열이 지배하여 설계안 간 차이는 1 K 내외, 무대책 대비 약 4.4 K 낮다.

---

## 3. 풍하중 (`wind.js`)
* q = ½ρV² (ρ 1.225), V = 지붕 높이 3초 순간풍속.
* 양력 = q·C_p,up·A_plan, 항력 = q·C_p,drag·A_side (표시용), 자중 = m g. 망(D)은 주어진 C_p 가 다공성 반영.
* 단계 내력 R_i = Σ n·R_item·η, η = 0.75 (n > 4, 불균등 분담) / 1.0 (n ≤ 4).
  `fromParam: 'strapLC'` → R_item = LC[kN]·1000 × 2가닥 × 0.5.
* 단계 위 자중: 상판 질량 = arealHeatCap / 900 J/kgK × A_plan (Al 비열로 역산), 최하단은 전체 자중, 중간은 선형.
  (`loadPath[i].weightAboveKg` 가 있으면 우선.) 하중계수(0.9D)는 미적용.
* SF_i = (R_i + W_above,i)/uplift, SF = min, 지배 단계 = argmin (모든 단계가 같은 양력을 받으므로 V와 무관).
  한계풍속 V_cr = √(2·min(R_i + W_i)/(ρ C_p A)). 판정 ok ≥ 1.5 > warn ≥ 1.0 > fail. V = 0 → SF = ∞.
* `sfCurve`: V = step … Vmax (V = 0 의 ∞ 는 차트 편의상 제외).

V = 26 m/s: A 2.04 (상판 → 강관, V_cr 37.1) · B 2.83 (패널 → 레일, 43.8) · C 1.83 (스트랩, 35.2; LC 20 kN 이면 4.55 인양고리 지배) ·
D 1.65 (번지볼 = 퓨즈, 33.4) · E 2.10 (판 → 컨테이너, 37.7).
모든 계수는 가정값 — 실제 설치 전 **KDS 41 12 00** 설계풍속·가스트영향계수·국부 풍압계수로 재검토 필요.

---

## 4. 한계 (미반영)
* 지붕판·차열층의 면내 온도 분포(2절점 보간), 다중 반사(지붕 반사광 → 차열층 하면), 풍향별 유로 차이, 주변 건물 그림자.
* 지지재(레일·다리)를 통한 열교, 은박 노화·먼지(ε 증가), 비·결로·잠열 부하, 에어컨 부분부하 효율, 재실 스케줄.
* 채널 입구 공기 = 기상 관측 외기(현장 바닥 복사로 인한 지붕 높이 공기 가열 미반영).
* 풍하중: 동적 거동, 피로, 부식, 컨테이너 자체의 전도·활동, 수평력 경로.

## 참고문헌
NOAA GML *General Solar Position Calculations*; Hottel (1976) Solar Energy 18; Liu & Jordan (1960) Solar Energy 4;
Kasten & Young (1989) Applied Optics 28; Duffie & Beckman *Solar Engineering of Thermal Processes*; Swinbank (1963) QJRMS 89;
Berdahl & Martin (1984) Solar Energy 32; Watmuff, Charters & Proctor (1977); ASHRAE *Handbook — Fundamentals*;
Incropera *Fundamentals of Heat and Mass Transfer* (Hilpert, Churchill–Chu, Gnielinski, Shah & London);
Gross, Spindler & Hahne (1981) *Letters in Heat and Mass Transfer* 8; FAO-56 (Allen et al. 1998); KDS 41 12 00.
