// GoPlus Security: contract-level token security checks for EVM chains and Solana.
// Free public API. Returns which checks were completed vs. not verifiable.

import { fetchJson } from "@/lib/fetch";

export type CheckStatus = "pass" | "warn" | "fail" | "unverified";

export interface SecurityCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface SecurityReport {
  source: string;
  chain: string;
  address: string;
  checks: SecurityCheck[];
  holders: {
    count: number | null;
    top10Pct: number | null;
    creatorPct: number | null;
  };
  taxes: { buyPct: number | null; sellPct: number | null };
  isOpenSource: boolean | null;
  riskScore: number; // 0 (clean) .. 100 (avoid)
  summary: string;
}

const BASE = "https://api.gopluslabs.io/api/v1";
const opts = { provider: "goplus", ttl: 300_000 };

const b = (v: unknown): boolean | null =>
  v === "1" ? true : v === "0" ? false : null;
const pct = (v: unknown): number | null =>
  v == null || v === "" ? null : Number(v) * 100;

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function evmTokenSecurity(
  goplusChainId: string,
  address: string,
): Promise<SecurityReport> {
  const r = await fetchJson<{ code: number; result: Record<string, any> }>(
    `${BASE}/token_security/${goplusChainId}?contract_addresses=${address.toLowerCase()}`,
    opts,
  );
  const d = r.result?.[address.toLowerCase()];
  if (!d)
    return empty(
      "goplus",
      goplusChainId,
      address,
      "GoPlus has no record for this contract.",
    );

  const checks: SecurityCheck[] = [];
  const flag = (
    key: string,
    label: string,
    val: boolean | null,
    badWhenTrue: boolean,
    bad: string,
    good: string,
    sev: CheckStatus = "fail",
  ) => {
    if (val === null)
      checks.push({
        key,
        label,
        status: "unverified",
        detail: "Not verifiable from GoPlus data.",
      });
    else if (val === badWhenTrue)
      checks.push({ key, label, status: sev, detail: bad });
    else checks.push({ key, label, status: "pass", detail: good });
  };

  flag(
    "honeypot",
    "Honeypot",
    b(d.is_honeypot),
    true,
    "Token appears to be a honeypot - buyers cannot sell.",
    "Not flagged as a honeypot.",
  );
  flag(
    "open_source",
    "Verified source code",
    b(d.is_open_source),
    false,
    "Contract source is not verified.",
    "Source code is verified.",
    "warn",
  );
  flag(
    "proxy",
    "Proxy contract",
    b(d.is_proxy),
    true,
    "Upgradeable proxy - logic can change after launch.",
    "Not a proxy.",
    "warn",
  );
  flag(
    "mintable",
    "Mintable",
    b(d.is_mintable),
    true,
    "Owner can mint new tokens (supply inflation risk).",
    "Not mintable.",
    "warn",
  );
  flag(
    "owner_change_balance",
    "Owner can change balances",
    b(d.owner_change_balance),
    true,
    "Owner can edit holder balances.",
    "Owner cannot change balances.",
  );
  flag(
    "hidden_owner",
    "Hidden owner",
    b(d.hidden_owner),
    true,
    "Hidden owner functions detected.",
    "No hidden owner.",
  );
  flag(
    "selfdestruct",
    "Self-destruct",
    b(d.selfdestruct),
    true,
    "Contract can self-destruct.",
    "No self-destruct.",
  );
  flag(
    "external_call",
    "External call",
    b(d.external_call),
    true,
    "Makes external calls (possible manipulation).",
    "No suspicious external calls.",
    "warn",
  );
  flag(
    "blacklist",
    "Blacklist function",
    b(d.is_blacklisted),
    true,
    "Can blacklist wallets from trading.",
    "No blacklist.",
    "warn",
  );
  flag(
    "whitelist",
    "Whitelist function",
    b(d.is_whitelisted),
    true,
    "Has whitelist (may gate trading).",
    "No whitelist.",
    "warn",
  );
  flag(
    "anti_whale",
    "Anti-whale modifiable",
    b(d.anti_whale_modifiable),
    true,
    "Owner can change anti-whale limits.",
    "Limits fixed.",
    "warn",
  );
  flag(
    "trading_cooldown",
    "Trading cooldown",
    b(d.trading_cooldown),
    true,
    "Has trading cooldown.",
    "No cooldown.",
    "warn",
  );
  flag(
    "can_take_back_ownership",
    "Ownership can be reclaimed",
    b(d.can_take_back_ownership),
    true,
    "Renounced ownership can be taken back.",
    "Cannot reclaim ownership.",
  );
  flag(
    "cannot_sell_all",
    "Cannot sell all",
    b(d.cannot_sell_all),
    true,
    "Holders cannot sell entire balance.",
    "Full sells allowed.",
    "warn",
  );
  flag(
    "transfer_pausable",
    "Transfer pausable",
    b(d.transfer_pausable),
    true,
    "Owner can pause transfers.",
    "Transfers not pausable.",
    "warn",
  );
  flag(
    "slippage_modifiable",
    "Tax modifiable",
    b(d.slippage_modifiable),
    true,
    "Owner can change buy/sell tax.",
    "Tax not modifiable.",
    "warn",
  );

  const buyTax = pct(d.buy_tax);
  const sellTax = pct(d.sell_tax);
  if (buyTax == null && sellTax == null)
    checks.push({
      key: "tax",
      label: "Buy/sell tax",
      status: "unverified",
      detail: "Tax not simulated.",
    });
  else {
    const mx = Math.max(buyTax ?? 0, sellTax ?? 0);
    checks.push({
      key: "tax",
      label: "Buy/sell tax",
      status: mx >= 20 ? "fail" : mx >= 5 ? "warn" : "pass",
      detail: `Buy ${buyTax?.toFixed(1) ?? "?"}% / Sell ${sellTax?.toFixed(1) ?? "?"}%`,
    });
  }

  const holders = d.holders as
    | { percent: string; is_contract: number; is_locked: number }[]
    | undefined;
  const top10 = holders
    ? holders.slice(0, 10).reduce((s, h) => s + Number(h.percent) * 100, 0)
    : null;
  const creatorPct = pct(d.creator_percent);
  if (top10 == null)
    checks.push({
      key: "concentration",
      label: "Holder concentration",
      status: "unverified",
      detail: "Holder data unavailable.",
    });
  else
    checks.push({
      key: "concentration",
      label: "Holder concentration",
      status: top10 > 60 ? "fail" : top10 > 35 ? "warn" : "pass",
      detail: `Top 10 holders control ${top10.toFixed(1)}% of supply.`,
    });

  const lp = d.lp_holders as
    | { percent: string; is_locked: number; address: string }[]
    | undefined;
  if (!lp)
    checks.push({
      key: "lp",
      label: "Liquidity lock",
      status: "unverified",
      detail: "LP holder data unavailable.",
    });
  else {
    const locked = lp
      .filter((x) => x.is_locked === 1 || /dead|0{10}/.test(x.address))
      .reduce((s, x) => s + Number(x.percent) * 100, 0);
    checks.push({
      key: "lp",
      label: "Liquidity lock",
      status: locked >= 80 ? "pass" : locked >= 40 ? "warn" : "fail",
      detail: `~${locked.toFixed(0)}% of LP tokens locked or burned.`,
    });
  }

  const riskScore = scoreChecks(checks);
  return {
    source: "goplus",
    chain: goplusChainId,
    address,
    checks,
    holders: {
      count: d.holder_count ? Number(d.holder_count) : null,
      top10Pct: top10,
      creatorPct,
    },
    taxes: { buyPct: buyTax, sellPct: sellTax },
    isOpenSource: b(d.is_open_source),
    riskScore,
    summary: summarize(riskScore, checks),
  };
}

export async function solanaTokenSecurity(
  address: string,
): Promise<SecurityReport> {
  const r = await fetchJson<{ code: number; result: Record<string, any> }>(
    `${BASE}/solana/token_security?contract_addresses=${address}`,
    opts,
  );
  const d = r.result?.[address];
  if (!d)
    return empty(
      "goplus",
      "solana",
      address,
      "GoPlus has no record for this mint.",
    );
  const checks: SecurityCheck[] = [];
  const auth = (
    key: string,
    label: string,
    obj: any,
    bad: string,
    good: string,
  ) => {
    const status = obj?.status;
    if (status == null)
      checks.push({
        key,
        label,
        status: "unverified",
        detail: "Not reported.",
      });
    else if (status === "1")
      checks.push({ key, label, status: "warn", detail: bad });
    else checks.push({ key, label, status: "pass", detail: good });
  };
  auth(
    "mint",
    "Mint authority",
    d.mintable,
    "Mint authority still active - supply can inflate.",
    "Mint authority revoked.",
  );
  auth(
    "freeze",
    "Freeze authority",
    d.freezable,
    "Freeze authority active - wallets can be frozen.",
    "Freeze authority revoked.",
  );
  auth(
    "closable",
    "Closable",
    d.closable,
    "Token account can be closed by authority.",
    "Not closable.",
  );
  auth(
    "transfer_fee",
    "Transfer fee",
    d.transfer_fee_upgradable,
    "Transfer fee is upgradable.",
    "No upgradable transfer fee.",
  );
  auth(
    "non_transferable",
    "Non-transferable",
    d.non_transferable,
    "Token is non-transferable.",
    "Transferable.",
  );
  auth(
    "balance_mutable",
    "Balance mutable",
    d.balance_mutable_authority,
    "An authority can mutate balances.",
    "Balances immutable.",
  );
  if (d.trusted_token === 1)
    checks.push({
      key: "trusted",
      label: "Trusted token",
      status: "pass",
      detail: "Listed as a trusted token by GoPlus.",
    });

  const holders = d.holders as { percent: string }[] | undefined;
  const top10 = holders
    ? holders.slice(0, 10).reduce((s, h) => s + Number(h.percent) * 100, 0)
    : null;
  if (top10 == null)
    checks.push({
      key: "concentration",
      label: "Holder concentration",
      status: "unverified",
      detail: "Holder data unavailable.",
    });
  else
    checks.push({
      key: "concentration",
      label: "Holder concentration",
      status: top10 > 60 ? "fail" : top10 > 35 ? "warn" : "pass",
      detail: `Top 10 holders control ${top10.toFixed(1)}% of supply.`,
    });

  const riskScore = scoreChecks(checks);
  return {
    source: "goplus",
    chain: "solana",
    address,
    checks,
    holders: {
      count: d.holder_count ? Number(d.holder_count) : null,
      top10Pct: top10,
      creatorPct: null,
    },
    taxes: { buyPct: null, sellPct: null },
    isOpenSource: null,
    riskScore,
    summary: summarize(riskScore, checks),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function scoreChecks(checks: SecurityCheck[]) {
  let s = 0;
  for (const c of checks) {
    if (c.status === "fail") s += c.key === "honeypot" ? 60 : 20;
    else if (c.status === "warn") s += 6;
    else if (c.status === "unverified") s += 2;
  }
  return Math.min(100, s);
}

function summarize(score: number, checks: SecurityCheck[]) {
  const fails = checks.filter((c) => c.status === "fail").length;
  const unv = checks.filter((c) => c.status === "unverified").length;
  const tail = unv
    ? ` ${unv} check${unv > 1 ? "s" : ""} could not be verified.`
    : "";
  if (score >= 60)
    return `High risk - ${fails} critical issue${fails !== 1 ? "s" : ""} found.${tail}`;
  if (score >= 25)
    return `Elevated risk - review the flagged permissions before trading.${tail}`;
  return `No critical issues detected in automated checks.${tail}`;
}

function empty(
  source: string,
  chain: string,
  address: string,
  why: string,
): SecurityReport {
  return {
    source,
    chain,
    address,
    checks: [
      {
        key: "none",
        label: "Security scan",
        status: "unverified",
        detail: why,
      },
    ],
    holders: { count: null, top10Pct: null, creatorPct: null },
    taxes: { buyPct: null, sellPct: null },
    isOpenSource: null,
    riskScore: 30,
    summary: `Security could not be verified: ${why}`,
  };
}
