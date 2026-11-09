// Stage 40 - Academy: short beginner lessons with quizzes, shared by the website (/learn) and the Telegram bot (/learn).
// Plain language, tied to how AsheSignal works. No em or en dashes anywhere (project rule).

export interface QuizQ { q: string; options: string[]; answer: number; why: string }
export interface Lesson { id: string; title: string; /** fits a phone button */ short: string; emoji: string; minutes: number; summary: string; body: string[]; keyPoints: string[]; quiz: QuizQ[]; link?: { label: string; href: string } }

export const LESSONS: Lesson[] = [
  {
    id: "stop-loss", short: "Stop loss", title: "The stop loss", emoji: "🛑", minutes: 3,
    summary: "The price where you admit the trade was wrong, decided before you enter.",
    body: [
      "Every trade idea has a point where it is clearly wrong. For a long, that is usually just under the support or the breakout level the idea depends on. The stop loss sits there.",
      "You choose the stop first, then the size. The stop is not a guess about how much pain you can take; it is where the chart says the reason for the trade no longer exists.",
      "On an exchange the stop is an order, so it works while you sleep. On Coinbase spot you attach it as a stop-limit sell right after the buy fills.",
      "Moving a stop further away to avoid being stopped out turns a small planned loss into a large unplanned one. Moving it closer to lock in profit (to break-even after TP1) is fine.",
    ],
    keyPoints: ["Decide the stop before entering", "Stop comes from the chart, size comes from the stop", "Never widen a stop; only tighten it"],
    quiz: [
      { q: "When do you decide where the stop goes?", options: ["After the trade goes against you", "Before you enter", "When it hits TP1"], answer: 1, why: "The stop is part of the plan. Deciding it later means deciding with emotions." },
      { q: "Price is falling toward your stop. What does the plan say?", options: ["Move the stop lower to give it room", "Leave it: either it holds or you are out as planned", "Remove the stop and wait"], answer: 1, why: "Widening a stop turns a small planned loss into a big one." },
      { q: "After TP1 hits, where does AsheSignal suggest moving the stop?", options: ["To break-even (your entry)", "Further away", "Nowhere, delete it"], answer: 0, why: "Moving to break-even makes the rest of the trade free of risk." },
    ],
    link: { label: "Trade guide", href: "/guide" },
  },
  {
    id: "r-multiple", short: "R multiples", title: "R: measuring trades by risk", emoji: "📏", minutes: 3,
    summary: "1R is the money you lose if the stop hits. Every result is measured in R.",
    body: [
      "If you buy at 100 with a stop at 95, your risk per coin is 5. That distance is 1R. A target at 110 is 10 away, so it is a 2R target.",
      "Thinking in R makes trades comparable no matter the coin or the size. A +2R win and a -1R loss net +1R.",
      "With 2R targets you can be wrong more than half the time and still grow the account: 4 wins and 6 losses is +8R -6R = +2R.",
      "AsheSignal shows R on every setup (TP1, TP2, TP3) and the Track record shows the engine's total R, so you can judge it the same way.",
    ],
    keyPoints: ["1R = entry to stop distance", "Wins and losses are counted in R", "Good R:R lets you win with under 50% hit rate"],
    quiz: [
      { q: "Entry 50, stop 48, target 56. What R is the target?", options: ["2R", "3R", "6R"], answer: 1, why: "Risk is 2 (50 to 48), reward is 6 (50 to 56): 6 / 2 = 3R." },
      { q: "You win 4 trades at +2R and lose 6 at -1R. Result?", options: ["-2R", "0R", "+2R"], answer: 2, why: "+8R from wins, -6R from losses: +2R overall." },
      { q: "A stop hit is how many R?", options: ["-1R", "-2R", "Depends on the coin"], answer: 0, why: "By definition the stop is 1R of loss (plus fees)." },
    ],
    link: { label: "Track record", href: "/track-record" },
  },
  {
    id: "sizing", short: "Position size", title: "Position size and the 1% rule", emoji: "📐", minutes: 4,
    summary: "Size the trade so that hitting the stop costs a fixed small part of your account.",
    body: [
      "Pick how much of your account you will lose if the stop hits. AsheSignal defaults to 1%. With a 500 dollar account that is 5 dollars.",
      "Size = money at risk / distance to stop. Risk 5 dollars, entry 2.00, stop 1.90: the distance is 0.10, so you buy 50 coins (100 dollars of the coin).",
      "Notice the position (100 dollars) is much bigger than the risk (5 dollars). That is normal. What matters is what you lose at the stop, not what you buy.",
      "Leverage does not change the risk if you size this way; it only changes how much margin you put in. More leverage also brings the liquidation price closer, which can come before your stop.",
    ],
    keyPoints: ["Risk a fixed % (1%) per trade", "Units = risk dollars / stop distance", "Leverage changes margin, not the risk"],
    quiz: [
      { q: "Account 1,000 dollars, 1% risk, entry 10, stop 9.50. How many coins?", options: ["10", "20", "100"], answer: 1, why: "Risk 10 dollars / 0.50 distance = 20 coins (200 dollars of the coin)." },
      { q: "Why is the position bigger than the risk?", options: ["It is a mistake", "Because you only lose the distance to the stop, not the whole position", "Because of fees"], answer: 1, why: "If the stop works you lose the stop distance times the units, not everything." },
      { q: "What can high leverage do to your stop?", options: ["Nothing", "Put the liquidation price before the stop", "Make the stop free"], answer: 1, why: "With high leverage the exchange can close you before your stop ever triggers." },
    ],
    link: { label: "Position size calculator", href: "/risk" },
  },
  {
    id: "categories", short: "Categories", title: "Confirmed, Watching, Speculative, Spot", emoji: "🗂", minutes: 3,
    summary: "What each Trading Discovery category means and which ones to act on.",
    body: [
      "Confirmed: every engine gate passed (trend, a real trigger, volume, R:R, higher timeframe agreement, the engine's own record on that chart, market regime). These are the only setups the rules say to take.",
      "Watching: structure is building but something is missing. Each card says what. Set a 'when it confirms' alert instead of entering early.",
      "Speculative: new launches, memecoins, unusual volume. High risk by definition. If you touch them, use money you can lose completely.",
      "Spot investments: buy and hold ideas with an accumulation zone. No leverage, slow, built with a DCA plan.",
    ],
    keyPoints: ["Trade Confirmed, alert on Watching", "Speculative is lottery money", "Spot is slow DCA, not a trade"],
    quiz: [
      { q: "A coin is in Watching. What do the rules say?", options: ["Enter now before it confirms", "Set an alert for when it confirms", "Short it"], answer: 1, why: "Watching means a condition is missing. Wait for confirmation." },
      { q: "Which category is meant for slow buying over weeks?", options: ["Confirmed", "Speculative", "Spot investments"], answer: 2, why: "Spot picks come with an accumulation zone for DCA." },
      { q: "Does Confirmed mean the trade will win?", options: ["Yes", "No, it means the rules were met", "Only on 1d"], answer: 1, why: "It is a filter for quality, not a promise. The stop is still there." },
    ],
    link: { label: "Trading Discovery", href: "/opportunities" },
  },
  {
    id: "spot-coinbase", short: "Coinbase spot", title: "Spot trading on Coinbase", emoji: "🏦", minutes: 3,
    summary: "Buy, sell, no shorts, no leverage, and how the bracket order works.",
    body: [
      "Coinbase in Canada is spot only: you buy a coin with dollars or USDC and sell it later. You cannot short, so SHORT setups are sell or reduce signals for coins you already hold.",
      "There is no leverage, so your risk is simply units times the distance to your stop.",
      "Coinbase Advanced lets you attach a take profit and stop loss to a limit buy (a bracket). When the buy fills, both exits are live; when one fills, the other cancels.",
      "Profits come back in the quote currency you bought with (USD, USDC or CAD). Cancelling an unfilled order just returns the reserved funds; nothing is gained or lost.",
    ],
    keyPoints: ["Spot only: longs, no leverage", "SHORT signals = reduce what you hold", "Use the attached TP/SL bracket"],
    quiz: [
      { q: "The engine shows a confirmed SHORT on a coin you hold on Coinbase. What does it mean for you?", options: ["Open a short", "Consider selling or trimming", "Buy more"], answer: 1, why: "You cannot short on Coinbase spot; a short signal is a reason to reduce." },
      { q: "You cancel a limit buy that never filled. What happens?", options: ["You lose the fee", "The reserved money returns to your balance", "It turns into a market order"], answer: 1, why: "An unfilled order costs nothing; the funds are simply released." },
      { q: "What does the attached TP/SL bracket do?", options: ["Sells automatically at the target or the stop", "Buys more at the stop", "Nothing until you log in"], answer: 0, why: "Both exits become live orders once the buy fills." },
    ],
    link: { label: "Trade guide", href: "/guide?venue=coinbase" },
  },
  {
    id: "orders", short: "Order types", title: "Order types: market, limit, stop-limit", emoji: "🧾", minutes: 3,
    summary: "Which order to use for entries, targets and stops.",
    body: [
      "Market order: fills now at whatever price is available. Fast, but you pay the spread and slippage. Fine for small, liquid coins only.",
      "Limit order: fills only at your price or better. Use it for entries inside the entry zone and for take-profit sells.",
      "Stop-limit: when price touches the stop, a limit order is placed. Set the limit a little beyond the stop (about 0.5%) so it still fills in a fast drop.",
      "AsheSignal's order ticket on the trade guide writes these lines out for you with your amounts.",
    ],
    keyPoints: ["Entries and targets: limit orders", "Stops: stop-limit with a small buffer", "Market orders cost spread and slippage"],
    quiz: [
      { q: "Best order type for buying inside the entry zone?", options: ["Market", "Limit", "Stop-limit"], answer: 1, why: "A limit order only fills at your zone price or better." },
      { q: "Why put the stop-limit's limit a bit beyond the stop?", options: ["To pay more fees", "So it still fills if price moves fast", "It is required by law"], answer: 1, why: "Without a buffer, a fast move can skip your limit and leave you without an exit." },
      { q: "When is a market order acceptable?", options: ["Small size on a liquid coin", "Always", "On new memecoins"], answer: 0, why: "On liquid coins the slippage is tiny; on thin coins it can be large." },
    ],
    link: { label: "Order ticket", href: "/guide" },
  },
  {
    id: "risk-management", short: "Risk & heat", title: "Heat, limits and losing streaks", emoji: "🌡", minutes: 3,
    summary: "How much to have at risk at once, and why streaks are normal.",
    body: [
      "Portfolio heat is the total you would lose if every open stop hit at once. AsheSignal's default limit is 3% of your account across at most 3 trades.",
      "Coins move together. Three longs on three altcoins are close to one big bet on altcoins, so the limit protects you from that.",
      "Even a good system has losing streaks. With a 45% win rate, five losses in a row will happen. At 1% risk that is 5%, survivable. At 10% risk it is half the account.",
      "The pre-trade check and the Plan page show your heat and remaining budget before every trade.",
    ],
    keyPoints: ["Keep total open risk under 3%", "Correlated trades count as one big bet", "Streaks are normal; small risk survives them"],
    quiz: [
      { q: "Three open trades each risk 1%. What is your heat?", options: ["1%", "3%", "Depends on the coins"], answer: 1, why: "Heat is the sum of open risk: 3 x 1% = 3%." },
      { q: "Why is risking 10% per trade dangerous?", options: ["Fees", "A normal losing streak can halve the account", "Coinbase forbids it"], answer: 1, why: "Five losses in a row at 10% each costs about 41% of the account." },
      { q: "Three alt longs at once are...", options: ["Fully independent", "Close to one big bet on alts", "Hedged"], answer: 1, why: "Altcoins tend to move together, so the risks add up." },
    ],
    link: { label: "Today's plan", href: "/plan" },
  },
  {
    id: "reading-cards", short: "Reading cards", title: "Reading an AsheSignal card", emoji: "🪪", minutes: 3,
    summary: "What each number on a setup card means and what to do with it.",
    body: [
      "Entry zone: the price range to place your limit buy. 'Price above the zone' means wait; do not chase.",
      "TP1, TP2, TP3: take 30%, 30% and 40% at each. After TP1, the stop moves to break-even.",
      "SL1 is the stop. SL2 is a wider fallback some traders use; AsheSignal sizes from SL1.",
      "Confidence and R: confidence blends the engine's evidence and its past record on that chart; R tells you reward per unit of risk. Low R (under 1.5) is rarely worth it.",
      "Pre-trade check: GO, CAREFUL or WAIT, with each reason listed. Read it before 'I took this trade'.",
    ],
    keyPoints: ["Wait for price in the entry zone", "30/30/40 at TP1/TP2/TP3", "Read the pre-trade check first"],
    quiz: [
      { q: "The card says 'price 3% above the zone'. What do you do?", options: ["Buy at market now", "Set a limit in the zone or skip", "Short it"], answer: 1, why: "Chasing worsens your entry and your R. Let price come to you." },
      { q: "What do you do at TP1?", options: ["Sell everything", "Take about 30% and move the stop to break-even", "Add more"], answer: 1, why: "That is the plan built into every AsheSignal setup." },
      { q: "Which stop is the size calculated from?", options: ["SL1", "SL2", "Neither"], answer: 0, why: "SL1 is the planned stop; SL2 is only a fallback." },
    ],
    link: { label: "Confirmed trades", href: "/opportunities?cat=confirmed" },
  },
];

export const lessonById = (id: string) => LESSONS.find((l) => l.id === id) ?? null;
