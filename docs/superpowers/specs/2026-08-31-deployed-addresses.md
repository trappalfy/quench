# Развёрнутые контракты — Robinhood Chain

Статус: **развёрнуто и проверено 2026-08-31**. Исходники на эксплорере ещё не
верифицированы — см. `docs/verifying-sources.md`.

Этот документ — вход для подпроекта 2 (фронтенд). Всё, что нужно клиенту, чтобы
разговаривать с протоколом, лежит здесь.

## Сеть

| | |
|---|---|
| Название | Robinhood Chain |
| chainId | `4663` |
| RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Эксплорер | `https://robinhoodchain.blockscout.com` |
| Тип | Arbitrum Orbit (Nitro), ArbOS 116 |
| Нативная валюта | ETH (18 знаков) |

## Адреса

| Контракт | Адрес |
|---|---|
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| Launchpad | `0x5eE09DF35b6C3503D8fAc6A2863aFd4edBC73a6c` |
| BlockHook | `0x011a41285314efFE83de63404Aa759a85472E8Cc` |
| BoundedRouter | `0xD689c128506611e05bf72212eA94B7Df4f9C7C17` |
| HookDeployer | `0xeD4856D6CB5883FBC591217482101AE4c5276831` |
| PotVault | `0x02007750325A4311043CFDEb67Fce87eBe10A380` |
| BondingCurve (образец для клонов) | `0xc149D722195b4915aBf2a64cbBe0e54205119D66` |

Развёрнуто в блоке `50723079`, отправитель `0x6184d02682B77756580D3d0912da0ffc39DfE73f`,
соль хука `0x0000000000000000000000000000000000000000000000000000000000000db8`.

`PotVault` и `BondingCurve` в списке для полноты: напрямую фронтенд к ним не
обращается. Клон кривой создаётся на каждый запуск отдельно, его адрес возвращает
`launchCurve` и хранит `launchRecord(token).curve`.

## Разрешения хука

Адрес хука кончается на `E8Cc`; младшие 14 бит дают `0x28CC`:

`BEFORE_INITIALIZE` · `BEFORE_ADD_LIQUIDITY` · `BEFORE_SWAP` · `AFTER_SWAP` ·
`BEFORE_SWAP_RETURNS_DELTA` · `AFTER_SWAP_RETURNS_DELTA`

Проверять этот набор стоит на клиенте при построении `PoolKey`: PoolManager
отвергнет пул, у которого адрес хука не кодирует ровно эти права.

## Зашитые параметры

Всё это неизменяемо — ни владельца, ни админа, ни пути обновления у системы нет.

| Параметр | Значение |
|---|---|
| `protocolFeeRecipient` | `0xef048611d7F3077b35Fab260565886186fDa32bA` |
| `maxPoolEthWei` | `100000000000000000000` (100 ETH) |
| `TICK_SPACING` | 60 |
| Эмиссия токена | 1 000 000 000 · 1e18 |
| `GRADUATION_SUPPLY` | 200 000 000 · 1e18 |
| `CURVE_SUPPLY` | 800 000 000 · 1e18 (10 траншей по 80 000 000) |
| `TRADE_FEE_BPS` (кривая) | 100 (1%) |
| `MAX_CREATOR_FEE_BPS` | 8 000 |
| `MAX_ROYALTY_BPS` | 2 000 |

## Что вызывает фронтенд

### Launchpad

Запуски и реестры.

```solidity
launchInstant(InstantParams p) payable returns (address token)
launchCurve(CurveParams p) returns (address token, address curve)
publishBlueprint(BlockConfig cfg, uint16 royaltyBps) returns (uint256 id)
claimFees(address token)

launchCount() view returns (uint256)
tokenAt(uint256 i) view returns (address)
launchRecord(address token) view returns (LaunchRecord)
poolKeyOf(address token) view returns (PoolKey)
blueprintCount() view returns (uint256)
blueprintAt(uint256 i) view returns (Blueprint)
```

Блюпринт с индексом 0 — заглушка (`author == address(0)`), в UI её не показывать.
Реальные начинаются с 1, поэтому «блюпринтов опубликовано» = `blueprintCount() - 1`.

### BoundedRouter

Единственная точка торговли в пуле. Прямые свопы через PoolManager мимо роутера
хук не считает своим покупателем: `hookData` с получателем принимается только от
роутера, иначе приз в банке не начисляется.

```solidity
buy(PoolKey key, uint256 minAmountOut, address recipient, uint256 deadline) payable returns (uint256)
buyExactOutput(PoolKey key, uint256 amountOut, address recipient, uint256 deadline) payable returns (uint256)
sell(PoolKey key, uint256 amountIn, uint256 minEthOut, address recipient, uint256 deadline) returns (uint256 ethOut)
```

Перед `sell` нужен `approve` токена на роутер. Роутер ничего не хранит между
транзакциями — остаток ETH возвращается отправителю в той же транзакции.

### BondingCurve (клон конкретного запуска)

```solidity
buy(uint256 minTokensOut, address recipient) payable returns (uint256)
sell(uint256 tokens, uint256 minEthOut) returns (uint256 ethOut)

quoteBuy(uint256 ethIn) view returns (uint256 tokensOut, uint256 spent, bool graduates)
priceOfTranche(uint8 i) view returns (uint256)
trancheOf(uint256 soldSoFar) pure returns (uint8)
totalRaiseAtFullSellout(uint256 p0) pure returns (uint256)
sold() view returns (uint256)
graduated() view returns (bool)
```

`quoteBuy` — то, что показывать в интерфейсе до подтверждения: он возвращает и
количество токенов, и сколько ETH реально уйдёт, и произойдёт ли выпуск в пул на
этой покупке. Покупка, переходящая границу транша, платит по обеим ценам.

### BlockHook

```solidity
configOf(PoolId id) view returns (BlockConfig)
stateOf(PoolId id) view returns (PoolState)
potVault() view returns (address)
```

`PotVault.balanceOf(PoolId id) view returns (uint256)` — сколько сейчас в банке.

### События для ленты и индексации

| Контракт | Событие |
|---|---|
| Launchpad | `Launched(address indexed token, address indexed creator, address curve, uint256 blueprintId, uint160 sqrtPriceX96)` |
| Launchpad | `BlueprintPublished(uint256 indexed id, address indexed author, uint16 royaltyBps)` |
| Launchpad | `FeesClaimed(...)` |
| BlockHook | `PoolConfigured(PoolId indexed id, BlockConfig cfg)` |
| BlockHook | `PotPaid(PoolId indexed id, address indexed winner, uint256 amount, uint32 buyIndex)` |
| BlockHook | `AutoBurned(PoolId indexed id, uint256 amount)` |
| BondingCurve | `Bought(address indexed buyer, address indexed recipient, uint256 ethIn, uint256 tokensOut)` |
| BondingCurve | `Sold(address indexed seller, uint256 tokensIn, uint256 ethOut)` |
| BondingCurve | `Graduated(address indexed token, uint256 ethToPool, uint160 sqrtPriceX96)` |

## ABI

Собираются из репозитория: `forge build`, дальше `out/<Файл>.sol/<Контракт>.json`,
поле `.abi`. Отдельно публиковать их не нужно — они детерминированы по коммиту.

Расчёт комиссии всплеска и размера банка на клиенте уже есть: `ts/src/simulate.ts`,
побитово сверенный с Solidity на 2000 векторах.

## Чего ещё нет

- Исходники не верифицированы на эксплорере — `docs/verifying-sources.md`.
- Внешнего аудита не было. Порог, при котором он обязателен, — 500 ETH TVL,
  см. §10 спецификации контрактов.
- Ни одного запуска: `launchCount() == 0`. Публичные запуски — после того как
  фронтенд будет готов и поднят на домене.
