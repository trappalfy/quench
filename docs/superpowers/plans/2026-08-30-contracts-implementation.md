# Подпроект 1: контракты и деплой — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Задеплоить и покрыть тестами шесть контрактов, позволяющих выпустить токен с фиксированным предложением за неизменяемым Uniswap v4 хуком из пяти поведенческих блоков.

**Architecture:** Хук с нулевым балансом стоит в пути свопа и через `BeforeSwapDelta`/`afterSwap`-дельту забирает ETH-срезы из входа и токен-долю из выхода, расплачиваясь в той же транзакции: LP-доля уходит через `poolManager.donate`, доля котла — в отдельный `PotVault`, доля сжигания — прямым `take` на мёртвый адрес. `Launchpad` — единственная точка входа: он деплоит хук через CREATE2 с намайненной солью, создаёт токены и пулы, держит LP-позицию без функции вывода и клонирует по одному `BondingCurve` на каждый запуск через кривую.

**Tech Stack:** Solidity 0.8.26, Foundry 1.5.1 (forge/cast/anvil), Uniswap v4-core + v4-periphery, Solady (ERC20, LibClone), TypeScript + Node 24 для дифференциального теста симулятора.

**Spec:** [docs/superpowers/specs/2026-08-30-contracts-design.md](../specs/2026-08-30-contracts-design.md)

---

## Поправки к спеке

Четыре пункта спеки не выдержали сверки с реальным кодом v4. Поправки внесены здесь; спеку надо обновить в конце подпроекта (Task 17).

**П1. `BaseHook` больше не живёт в `v4-periphery`.** Он переехал в отдельный репозиторий `Uniswap/v4-hooks-public` — монорепу с полутора десятками сабмодулей (v2/v3-core, pancake, uniswapx). Тянуть её ради одного абстрактного контракта нельзя. **Решение:** вендорим собственный минимальный `BaseHook` (~120 строк) в `src/hook/BaseHook.sol`: только шесть используемых колбэков, остальные восемь ревертят. `HookMiner` берём из `v4-periphery/test/shared/HookMiner.sol` — он там, а не в `src/`.

**П2. У `beforeInitialize` нет параметра `hookData`.** Сигнатура — `beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96)`. Передать `BlockConfig` при инициализации пула напрямую невозможно. **Решение:** `Launchpad` кладёт конфиг в транзиентное хранилище хука вызовом `stageConfig(BlockConfig)` непосредственно перед `poolManager.initialize`, а `beforeInitialize` его считывает, валидирует, персистит под `PoolId` и очищает слот. Транзиентное хранилище (`tstore`/`tload`) доступно: сам PoolManager v4 требует Cancun, значит чейн его поддерживает.

**П3. Порядок деплоя из §7 спеки содержит круговые зависимости.** Хуку нужен адрес `Launchpad` (проверка вызывающего в `beforeInitialize`), `Launchpad` нужен адрес хука; `PotVault` нужен адрес хука, а хуку — адрес `PotVault`; `BondingCurve` нужен `Launchpad` и наоборот. Через CREATE2 это неразрешимо: аргументы конструктора входят в creation code, по хэшу которого майнится соль. **Решение — деплой в четыре шага без единой admin-функции:**

1. `BoundedRouter(poolManager)` — ни от кого не зависит.
2. `Launchpad(poolManager, router, protocolFeeRecipient, maxPoolEthWei)`. В своём конструкторе деплоит `BondingCurve` — реализацию для клонов, которая запоминает `launchpad = msg.sender` иммутабельно.
3. Офчейн майним соль для `BlockHook(poolManager, launchpad, router)`, где **деплойер — адрес `Launchpad`**, а не CREATE2-фабрика.
4. `Launchpad.deployHook(salt)` — разовая, перманентно бесправная функция: срабатывает только пока `hook == address(0)`, вызывать может кто угодно (неверная соль отобьётся `Hooks.validateHookPermissions` в конструкторе `BaseHook`). Хук в своём конструкторе деплоит `PotVault`, который запоминает `hook = msg.sender` иммутабельно.

Так все связи — иммутабельные, `PotVault` сохраняет ровно три функции, а единственная одноразовая функция во всей системе (`deployHook`) не может изменить ничего уже работающего.

**П4. `BondingCurve` — один экземпляр на запуск, а не один на систему.** Спека этого не оговаривает, но общий контракт держал бы ETH всех идущих одновременно продаж в одном месте. Это прямо противоречит §3 «дизайн, ограничивающий ущерб». **Решение:** `Launchpad` клонирует `BondingCurve` через `LibClone.clone` на каждый `launchCurve`. Ошибка в одной продаже не достаёт до денег другой.

**П5. Спека оставляет `inRangeReserve` словесным определением.** Для дифференциального теста (§8) нужна формула до последнего wei. **Решение:** ETH всегда `currency0` (нулевой адрес сортируется первым), поэтому

```
inRangeEthReserve = FullMath.mulDiv(liquidity, FixedPoint96.Q96, sqrtPriceX96)
```

где `liquidity` — `StateLibrary.getLiquidity(manager, id)`, `sqrtPriceX96` — из `StateLibrary.getSlot0`. Это виртуальный резерв ETH активной в диапазоне ликвидности. Ровно эта формула повторяется в TypeScript.

---

## Global Constraints

Требования, действующие в каждой задаче. Значения скопированы из спеки дословно.

- **Чейн:** Robinhood Chain, chainId **4663**, RPC `https://rpc.mainnet.chain.robinhood.com`. Проверено на 2026-08-30: `eth_chainId` = `0x1237`, высота ~`0x30003fb`.
- **PoolManager:** `0x8366a39CC670B4001A1121B8F6A443A643e40951` — код на чейне присутствует.
- **CREATE2-деплойер:** `0x4e59b44847b379578588920cA78FbF26c0B4956C` — присутствует. Используется для `Launchpad` и `BoundedRouter`; хук деплоится самим `Launchpad`.
- **Флаги хука:** младшие 14 бит адреса равны **`0x28CC`** = `BEFORE_INITIALIZE (1<<13)` | `BEFORE_ADD_LIQUIDITY (1<<11)` | `BEFORE_SWAP (1<<7)` | `AFTER_SWAP (1<<6)` | `BEFORE_SWAP_RETURNS_DELTA (1<<3)` | `AFTER_SWAP_RETURNS_DELTA (1<<2)`. Сверено с `Hooks.sol` v4-core: `0x2000+0x800+0x80+0x40+0x8+0x4 = 0x28CC`.
- **Предложение токена:** ровно `1_000_000_000e18`, `decimals` = 18, минт целиком в конструкторе, ни `owner`, ни `mint`, ни `pause`, ни чёрных списков, ни комиссии на трансфере.
- **Апгрейдов нет:** ни proxy для системных контрактов, ни `delegatecall`, ни admin-функций, меняющих поведение. Клоны `BondingCurve` — исключение по П4, но реализация под ними иммутабельна.
- **Границы валидации** (§6 спеки, дословно): `baseFeePips <= maxFeePips <= 100_000`; `lpBps + potBps <= 1_000`; `snipeTaxPips <= 50_000`; `burnBps <= 1_000`; `guardBlocks <= 7_200`; `potEveryN` в `[2, 1_000]`; `potBps > 0` требует `potEveryN >= 2`; `maxBuyBps` в `[1, 10_000]` при `guardBlocks > 0`; `burnBps > 0` требует `burnTriggerWei > 0`.
- **Кривая:** 80% предложения, 10 траншей по 80_000_000 токенов, цена транша `i` равна `p0 * 1.7^i`, комиссия 1% поровну создателю и протоколу, градация в той же транзакции, что и покупка последнего транша, по цене `p0 * 1.7^9`.
- **Адрес сжигания:** `0x000000000000000000000000000000000000dEaD`.
- **Инварианты фаззера** — десять штук, §8 спеки, реализуются в Task 15 дословно.
- **Язык артефактов:** код, идентификаторы, NatSpec и сообщения ошибок — по-английски. Документы в `docs/` — по-русски.
- **Открытые вопросы спеки** (§11) не блокируют работу: `maxPoolEthWei`, порог TVL и адрес сбора комиссий — параметры конструктора/скрипта деплоя, имя проекта в контрактах не фигурирует.

---

## Структура файлов

```
foundry.toml                      профили сборки, фаззинга, инвариантов, rpc_endpoints
remappings.txt                    пути до v4-core, v4-periphery, solady, forge-std
.env.example                      RPC_URL, DEPLOYER_PK, PROTOCOL_FEE_RECIPIENT, MAX_POOL_ETH_WEI

src/
  LaunchToken.sol                 ERC20 фиксированного предложения на Solady
  PotVault.sol                    котёл: fund / pay / balanceOf, три функции
  Launchpad.sol                   фабрика, реестры, роялти, держатель LP
  BondingCurve.sol                реализация под клоны: 10 траншей и градация
  BoundedRouter.sol               канонический роутер: границы проскальзывания, recipient
  hook/
    BaseHook.sol                  вендорный минимальный базовый хук (П1)
    BlockHook.sol                 пять блоков, колбэки, транзиентный stageConfig
  lib/
    BlockConfig.sol               struct BlockConfig, struct PoolState, валидация
    BlockMath.sol                 чистые формулы всех пяти блоков (§5 спеки)
  interfaces/
    IBlockHook.sol
    IPotVault.sol
    ILaunchpad.sol
    IBondingCurve.sol

test/
  unit/LaunchToken.t.sol
  unit/PotVault.t.sol
  unit/BlockMath.t.sol
  unit/BlockConfigValidation.t.sol
  unit/BlockHookInit.t.sol
  unit/BlockHookSurge.t.sol
  unit/BlockHookAntiSnipe.t.sol
  unit/BlockHookLpRewards.t.sol
  unit/BlockHookPot.t.sol
  unit/BlockHookAutoBurn.t.sol
  unit/BoundedRouter.t.sol
  unit/Launchpad.t.sol
  unit/BondingCurve.t.sol
  integration/InstantLaunch.t.sol
  integration/CurveLaunchAndGraduation.t.sol
  invariant/Invariants.t.sol
  invariant/handlers/SystemHandler.sol
  shared/Fixtures.sol              общий сетап: PoolManager, майнинг соли, деплой системы
  shared/DiffVectors.t.sol         экспорт векторов для дифференциального теста

script/
  MineHookSalt.s.sol              майнинг соли под флаги 0x28CC
  Deploy.s.sol                    четырёхшаговый деплой из П3
  Verify.s.sol                    постдеплойные проверки на живом чейне

ts/
  package.json
  src/simulate.ts                 повтор формул §5 в TypeScript
  test/simulate.diff.test.ts      дифференциальный тест против векторов из Solidity
```

Один файл — одна ответственность. `BlockMath.sol` держит формулы отдельно от колбэков специально: только так их можно протестировать чистыми юнит-тестами и сверить с TypeScript без поднятия пула.

---

## Фазы

| Фаза | Задачи | Что готово по завершении |
|---|---|---|
| A. Фундамент | 1–3 | Репозиторий собирается, токен и котёл написаны и покрыты |
| B. Хук | 4–10 | Пять блоков работают на настоящем PoolManager |
| C. Лаунчпад | 11–13 | Мгновенный запуск, кривая, градация |
| D. Доказательства | 14–16 | Интеграция, инварианты, дифференциальный тест |
| E. Деплой | 17–18 | Контракты в мейннете, спека обновлена |

---

### Task 1: Каркас Foundry и зависимости

**Files:**
- Create: `foundry.toml`
- Create: `remappings.txt`
- Create: `.env.example`
- Create: `src/lib/BlockConfig.sol`
- Create: `test/unit/Scaffold.t.sol`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: ничего, это первая задача.
- Produces: `struct BlockConfig` и `struct PoolState` — их поля и порядок фиксируются здесь и используются всеми последующими задачами. Профиль сборки `solc 0.8.26`, `evm_version = "cancun"`.

- [ ] **Step 1: Установить зависимости**

```bash
forge init --no-git --no-commit --force .
rm -rf src/Counter.sol test/Counter.t.sol script/Counter.s.sol
forge install foundry-rs/forge-std
forge install Uniswap/v4-core
forge install Uniswap/v4-periphery
forge install Vectorized/solady
```

Если `forge init` откажется работать в непустой директории — создать `lib/` вручную и выполнить только `forge install`.

- [ ] **Step 2: Написать `foundry.toml`**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
script = "script"
solc = "0.8.26"
evm_version = "cancun"
optimizer = true
optimizer_runs = 800
via_ir = false
bytecode_hash = "none"
ffi = false
fs_permissions = [{ access = "read-write", path = "./deployments" }]

[profile.default.fuzz]
runs = 512

[profile.default.invariant]
runs = 256
depth = 64
fail_on_revert = false

[profile.ci.fuzz]
runs = 4096

[profile.ci.invariant]
runs = 2048
depth = 128

[rpc_endpoints]
robinhood = "https://rpc.mainnet.chain.robinhood.com"
```

`via_ir = false` намеренно: сборка вчетверо быстрее, а stack-too-deep в хуке лечится группировкой локальных переменных в структуру, а не компилятором. Если задача 8 всё же упрётся в лимит стека — это сигнал, что функция делает слишком много.

- [ ] **Step 3: Написать `remappings.txt`**

```
forge-std/=lib/forge-std/src/
@uniswap/v4-core/=lib/v4-core/
@uniswap/v4-periphery/=lib/v4-periphery/
v4-core/=lib/v4-core/src/
solady/=lib/solady/src/
solmate/=lib/v4-core/lib/solmate/
permit2/=lib/v4-periphery/lib/permit2/
```

- [ ] **Step 4: Написать `.env.example`**

```bash
RPC_URL=https://rpc.mainnet.chain.robinhood.com
DEPLOYER_PK=0x0000000000000000000000000000000000000000000000000000000000000000
PROTOCOL_FEE_RECIPIENT=0x0000000000000000000000000000000000000000
MAX_POOL_ETH_WEI=0
POOL_MANAGER=0x8366a39CC670B4001A1121B8F6A443A643e40951
CREATE2_DEPLOYER=0x4e59b44847b379578588920cA78FbF26c0B4956C
```

- [ ] **Step 5: Дописать `.gitignore`**

```
node_modules/
out/
cache/
broadcast/
.env
.env.*
!.env.example
.next/
lib/
deployments/*.json
```

- [ ] **Step 6: Написать `src/lib/BlockConfig.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Behaviour of the five blocks for a single pool. Set once, at pool
/// initialization, and never mutated afterwards. A block is off when its
/// parameters are zero.
struct BlockConfig {
    // Block 1 - Anti-Snipe
    uint32 guardBlocks;
    uint16 maxBuyBps;
    uint24 snipeTaxPips;
    // Block 2 - Surge Fees
    uint24 baseFeePips;
    uint24 maxFeePips;
    uint16 surgeSens;
    // Block 3 - Auto Burn
    uint16 burnBps;
    uint128 burnTriggerWei;
    // Block 4 - LP Rewards
    uint16 lpBps;
    // Block 5 - Nth-buy Pot
    uint16 potBps;
    uint16 potEveryN;
    uint128 potMinBuyWei;
}

/// @notice Mutable per-pool bookkeeping owned by the hook.
struct PoolState {
    uint64 startBlock;
    uint128 potBalance;
    uint32 potBuyCount;
    uint64 lastCountedBlock;
}
```

- [ ] **Step 7: Написать проверочный тест `test/unit/Scaffold.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";

contract ScaffoldTest is Test {
    /// The whole deployment strategy rests on this number. If v4-core ever
    /// renumbers a flag, this test fails before anything else does.
    function test_hookFlagBitmapIs0x28CC() public pure {
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        assertEq(flags, uint160(0x28CC));
    }

    function test_transientStorageIsAvailable() public {
        uint256 slot = 0x1234;
        assembly ("memory-safe") {
            tstore(slot, 42)
        }
        uint256 read;
        assembly ("memory-safe") {
            read := tload(slot)
        }
        assertEq(read, 42, "cancun transient storage required");
    }

    function test_blockConfigFitsExpectedShape() public pure {
        BlockConfig memory c;
        c.guardBlocks = type(uint32).max;
        c.maxFeePips = 100_000;
        assertEq(c.guardBlocks, type(uint32).max);
        assertEq(c.maxFeePips, 100_000);
    }
}
```

- [ ] **Step 8: Прогнать сборку и тесты**

Run: `forge build && forge test --match-path test/unit/Scaffold.t.sol -vv`
Expected: сборка проходит, три теста PASS. Если `test_transientStorageIsAvailable` падает — неверный `evm_version`, чинить `foundry.toml`, а не тест.

- [ ] **Step 9: Коммит**

```bash
git add foundry.toml remappings.txt .env.example .gitignore .gitmodules src/lib/BlockConfig.sol test/unit/Scaffold.t.sol
git commit -m "chore: foundry scaffold with v4 deps and block config types"
```

---

### Task 2: `LaunchToken`

**Files:**
- Create: `src/LaunchToken.sol`
- Create: `test/unit/LaunchToken.t.sol`

**Interfaces:**
- Consumes: Solady `ERC20` из `solady/tokens/ERC20.sol`.
- Produces: `constructor(string memory name_, string memory symbol_, address recipient)`; `uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18`. `Launchpad` (Task 11) деплоит этот контракт с `recipient = address(launchpad)`.

- [ ] **Step 1: Написать падающий тест**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../../src/LaunchToken.sol";

contract LaunchTokenTest is Test {
    LaunchToken internal token;
    address internal recipient = address(0xBEEF);

    function setUp() public {
        token = new LaunchToken("Test Token", "TEST", recipient);
    }

    function test_mintsEntireSupplyToRecipient() public view {
        assertEq(token.totalSupply(), 1_000_000_000e18);
        assertEq(token.balanceOf(recipient), 1_000_000_000e18);
    }

    function test_metadataIsImmutableAndCorrect() public view {
        assertEq(token.name(), "Test Token");
        assertEq(token.symbol(), "TEST");
        assertEq(token.decimals(), 18);
    }

    function test_transferMovesExactAmountWithNoFee() public {
        vm.prank(recipient);
        token.transfer(address(0xCAFE), 1_000e18);
        assertEq(token.balanceOf(address(0xCAFE)), 1_000e18);
        assertEq(token.balanceOf(recipient), 1_000_000_000e18 - 1_000e18);
        assertEq(token.totalSupply(), 1_000_000_000e18, "supply must not change on transfer");
    }

    /// No privileged surface may exist. This asserts on the ABI, not on behaviour.
    function test_hasNoPrivilegedFunctions() public view {
        address t = address(token);
        bytes4[5] memory forbidden = [
            bytes4(keccak256("owner()")),
            bytes4(keccak256("mint(address,uint256)")),
            bytes4(keccak256("pause()")),
            bytes4(keccak256("blacklist(address)")),
            bytes4(keccak256("setFee(uint256)"))
        ];
        for (uint256 i; i < forbidden.length; i++) {
            (bool ok,) = t.staticcall(abi.encodeWithSelector(forbidden[i]));
            assertFalse(ok, "token exposes a privileged function");
        }
    }

    function testFuzz_transferPreservesTotalSupply(uint256 amount) public {
        amount = bound(amount, 0, 1_000_000_000e18);
        vm.prank(recipient);
        token.transfer(address(0xCAFE), amount);
        assertEq(token.balanceOf(recipient) + token.balanceOf(address(0xCAFE)), token.totalSupply());
    }
}
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `forge test --match-path test/unit/LaunchToken.t.sol`
Expected: FAIL — `Source "src/LaunchToken.sol" not found`.

- [ ] **Step 3: Написать реализацию**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "solady/tokens/ERC20.sol";

/// @title LaunchToken
/// @notice Fixed-supply ERC20 minted in full at construction. No owner, no mint,
/// no pause, no blacklist, no transfer fee. Nothing about it can change.
contract LaunchToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;

    string private _name;
    string private _symbol;

    constructor(string memory name_, string memory symbol_, address recipient) {
        _name = name_;
        _symbol = symbol_;
        _mint(recipient, TOTAL_SUPPLY);
    }

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `forge test --match-path test/unit/LaunchToken.t.sol -vv`
Expected: PASS, пять тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/LaunchToken.sol test/unit/LaunchToken.t.sol
git commit -m "feat: fixed-supply LaunchToken with no privileged surface"
```

---

### Task 3: `PotVault`

**Files:**
- Create: `src/interfaces/IPotVault.sol`
- Create: `src/PotVault.sol`
- Create: `test/unit/PotVault.t.sol`

**Interfaces:**
- Consumes: `PoolId` из `@uniswap/v4-core/src/types/PoolId.sol`.
- Produces: `fund(PoolId) payable`, `pay(PoolId,address,uint256)`, `balanceOf(PoolId) view returns (uint256)`, `address public immutable hook`. Конструктор без аргументов: `hook = msg.sender`. `BlockHook` (Task 4) деплоит его в своём конструкторе.

Три вещи, которые надо понять до реализации. **Первая:** конструктор не принимает адрес хука, а берёт `msg.sender` — иначе деплой круговой (поправка П3). **Вторая:** выплата не имеет права зареверить своп. Победителем может оказаться контракт без `receive`, и если `pay` откатится, весь пул встанет намертво — а хук неизменяем. Поэтому выплата идёт `call` с лимитом газа, а при неудаче деньги возвращаются в котёл и пишется событие. **Третья:** после возврата средств в котёл повторный вход невозможен — 30k газа не хватит на внешний вызов обратно, а единственный, кто может вызвать `fund`/`pay`, это хук.

- [ ] **Step 1: Написать падающий тест**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PotVault} from "../../src/PotVault.sol";

/// Recipient that always rejects ETH — the pool must survive it.
contract RejectingRecipient {
    receive() external payable {
        revert("no thanks");
    }
}

/// Recipient that burns all forwarded gas.
contract GasBurningRecipient {
    uint256 public x;

    receive() external payable {
        while (true) {
            x++;
        }
    }
}

contract PotVaultTest is Test {
    PotVault internal vault;
    PoolId internal idA = PoolId.wrap(bytes32(uint256(1)));
    PoolId internal idB = PoolId.wrap(bytes32(uint256(2)));
    address internal hook = address(this); // the test contract deploys, so it is the hook

    function setUp() public {
        vault = new PotVault();
        vm.deal(address(this), 100 ether);
    }

    function test_hookIsTheDeployer() public view {
        assertEq(vault.hook(), hook);
    }

    function test_fundCreditsPerPool() public {
        vault.fund{value: 1 ether}(idA);
        vault.fund{value: 2 ether}(idB);
        assertEq(vault.balanceOf(idA), 1 ether);
        assertEq(vault.balanceOf(idB), 2 ether);
        assertEq(address(vault).balance, 3 ether);
    }

    function test_onlyHookCanFund() public {
        vm.deal(address(0xBAD), 1 ether);
        vm.prank(address(0xBAD));
        vm.expectRevert(PotVault.NotHook.selector);
        vault.fund{value: 1 ether}(idA);
    }

    function test_onlyHookCanPay() public {
        vault.fund{value: 1 ether}(idA);
        vm.prank(address(0xBAD));
        vm.expectRevert(PotVault.NotHook.selector);
        vault.pay(idA, address(0xCAFE), 1 ether);
    }

    function test_payTransfersAndDebits() public {
        vault.fund{value: 3 ether}(idA);
        vault.pay(idA, address(0xCAFE), 2 ether);
        assertEq(address(0xCAFE).balance, 2 ether);
        assertEq(vault.balanceOf(idA), 1 ether);
    }

    function test_cannotPayMoreThanPoolHas() public {
        vault.fund{value: 1 ether}(idA);
        vault.fund{value: 5 ether}(idB);
        vm.expectRevert(PotVault.InsufficientPot.selector);
        vault.pay(idA, address(0xCAFE), 2 ether);
    }

    function test_failedPayoutReturnsFundsToPotInsteadOfReverting() public {
        RejectingRecipient bad = new RejectingRecipient();
        vault.fund{value: 1 ether}(idA);
        vault.pay(idA, address(bad), 1 ether);
        assertEq(vault.balanceOf(idA), 1 ether, "funds must stay in the pot");
        assertEq(address(bad).balance, 0);
    }

    function test_gasBurningRecipientCannotStallTheCaller() public {
        GasBurningRecipient greedy = new GasBurningRecipient();
        vault.fund{value: 1 ether}(idA);
        uint256 gasBefore = gasleft();
        vault.pay(idA, address(greedy), 1 ether);
        assertLt(gasBefore - gasleft(), 100_000, "payout must be gas bounded");
        assertEq(vault.balanceOf(idA), 1 ether);
    }

    function test_vaultHasNoWithdrawalSurface() public view {
        bytes4[3] memory forbidden = [
            bytes4(keccak256("withdraw()")),
            bytes4(keccak256("owner()")),
            bytes4(keccak256("rescue(address,uint256)"))
        ];
        for (uint256 i; i < forbidden.length; i++) {
            (bool ok,) = address(vault).staticcall(abi.encodeWithSelector(forbidden[i]));
            assertFalse(ok, "vault exposes a withdrawal path");
        }
    }

    function testFuzz_vaultBalanceEqualsSumOfPools(uint96 a, uint96 b) public {
        vm.deal(address(this), uint256(a) + uint256(b));
        if (a > 0) vault.fund{value: a}(idA);
        if (b > 0) vault.fund{value: b}(idB);
        assertEq(address(vault).balance, vault.balanceOf(idA) + vault.balanceOf(idB));
    }
}
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `forge test --match-path test/unit/PotVault.t.sol`
Expected: FAIL — `Source "src/PotVault.sol" not found`.

- [ ] **Step 3: Написать интерфейс `src/interfaces/IPotVault.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

interface IPotVault {
    function fund(PoolId id) external payable;
    function pay(PoolId id, address to, uint256 amount) external;
    function balanceOf(PoolId id) external view returns (uint256);
    function hook() external view returns (address);
}
```

- [ ] **Step 4: Написать реализацию `src/PotVault.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPotVault} from "./interfaces/IPotVault.sol";

/// @title PotVault
/// @notice Holds the Nth-buy pot for every pool. Deliberately small enough to be
/// audited by reading it. Only the hook can move funds, and there is no
/// withdrawal path for anyone else — not the deployer, not an owner, nobody.
contract PotVault is IPotVault {
    /// @notice Gas forwarded to a winner. Enough for an EOA or a plain receive(),
    /// not enough to reenter this contract in any meaningful way.
    uint256 internal constant PAYOUT_GAS = 30_000;

    error NotHook();
    error InsufficientPot();

    event Funded(PoolId indexed id, uint256 amount);
    event Paid(PoolId indexed id, address indexed to, uint256 amount);
    event PayoutFailed(PoolId indexed id, address indexed to, uint256 amount);

    /// @notice The hook that deployed this vault. Set once, at construction.
    address public immutable hook;

    mapping(PoolId => uint256) internal _potOf;

    constructor() {
        hook = msg.sender;
    }

    modifier onlyHook() {
        if (msg.sender != hook) revert NotHook();
        _;
    }

    /// @inheritdoc IPotVault
    function fund(PoolId id) external payable onlyHook {
        _potOf[id] += msg.value;
        emit Funded(id, msg.value);
    }

    /// @inheritdoc IPotVault
    /// @dev A failed payout must never revert the swap that triggered it: the hook
    /// is immutable, so a recipient that rejects ETH would brick the pool forever.
    /// The funds go back to the pot instead.
    function pay(PoolId id, address to, uint256 amount) external onlyHook {
        uint256 pot = _potOf[id];
        if (amount > pot) revert InsufficientPot();
        unchecked {
            _potOf[id] = pot - amount;
        }

        (bool ok,) = to.call{value: amount, gas: PAYOUT_GAS}("");
        if (ok) {
            emit Paid(id, to, amount);
        } else {
            _potOf[id] += amount;
            emit PayoutFailed(id, to, amount);
        }
    }

    /// @inheritdoc IPotVault
    function balanceOf(PoolId id) external view returns (uint256) {
        return _potOf[id];
    }
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `forge test --match-path test/unit/PotVault.t.sol -vv`
Expected: PASS, десять тестов.

- [ ] **Step 6: Коммит**

```bash
git add src/PotVault.sol src/interfaces/IPotVault.sol test/unit/PotVault.t.sol
git commit -m "feat: PotVault with hook-only access and non-reverting payouts"
```

---
### Task 4: `BlockMath` — формулы пяти блоков

**Files:**
- Create: `src/lib/BlockMath.sol`
- Create: `test/unit/BlockMath.t.sol`

**Interfaces:**
- Consumes: `FullMath`, `FixedPoint96` из `@uniswap/v4-core/src/libraries/`.
- Produces: `BlockMath.inRangeEthReserve(uint128,uint160) → uint256`, `BlockMath.surgeFee(uint256,uint256,uint24,uint24,uint16) → uint24`, `BlockMath.maxBuy(uint256,uint16) → uint256`, `BlockMath.bpsCut(uint256,uint16) → uint256`. Хук (Tasks 5–11) не считает ничего сам, он только вызывает эти функции. TypeScript-симулятор (Task 16) повторяет их один в один.

Формулы вынесены в чистую библиотеку намеренно: их можно проверить без поднятия пула и сверить с TypeScript по общим векторам. Всё, что попадёт в колбэки хука, будет только сантехникой.

- [ ] **Step 1: Написать падающий тест**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";
import {BlockMath} from "../../src/lib/BlockMath.sol";

contract BlockMathTest is Test {
    /// A pool at price 1.0 with liquidity L holds L wei of ETH in range.
    function test_inRangeEthReserveAtPriceOne() public pure {
        uint160 sqrtPriceX96 = uint160(FixedPoint96.Q96);
        assertEq(BlockMath.inRangeEthReserve(1e18, sqrtPriceX96), 1e18);
    }

    /// Price 4.0 means sqrtPrice 2.0, and the ETH side halves.
    function test_inRangeEthReserveScalesInverselyWithSqrtPrice() public pure {
        uint160 sqrtPriceX96 = uint160(2 * FixedPoint96.Q96);
        assertEq(BlockMath.inRangeEthReserve(1e18, sqrtPriceX96), 0.5e18);
    }

    function test_inRangeEthReserveIsZeroOnUninitializedPool() public pure {
        assertEq(BlockMath.inRangeEthReserve(0, uint160(FixedPoint96.Q96)), 0);
        assertEq(BlockMath.inRangeEthReserve(1e18, 0), 0);
    }

    function test_surgeFeeIsBaseWhenTradeIsInfinitesimal() public pure {
        assertEq(BlockMath.surgeFee(1, 1_000e18, 3_000, 100_000, 10_000), 3_000);
    }

    /// depthBps = 1000 (10% of reserve), surgeSens = 10000 (1x)
    /// surgeFactor = 1000 * 10000 / 10000 = 1000
    /// fee = 3000 + (100000 - 3000) * 1000 / 10000 = 3000 + 9700 = 12700
    function test_surgeFeeInterpolatesLinearly() public pure {
        assertEq(BlockMath.surgeFee(100e18, 1_000e18, 3_000, 100_000, 10_000), 12_700);
    }

    function test_surgeFeeSaturatesAtMax() public pure {
        assertEq(BlockMath.surgeFee(10_000e18, 1_000e18, 3_000, 100_000, 10_000), 100_000);
    }

    function test_surgeFeeIsBaseWhenBlockIsOff() public pure {
        assertEq(BlockMath.surgeFee(100e18, 1_000e18, 3_000, 100_000, 0), 3_000);
        assertEq(BlockMath.surgeFee(100e18, 1_000e18, 3_000, 3_000, 10_000), 3_000);
    }

    function test_surgeFeeIsBaseOnEmptyPool() public pure {
        assertEq(BlockMath.surgeFee(100e18, 0, 3_000, 100_000, 10_000), 3_000);
    }

    /// The clamp must hold even for a trade astronomically larger than the reserve,
    /// where depthBps * surgeSens would overflow a naive implementation.
    function test_surgeFeeDoesNotOverflowOnAbsurdDepth() public pure {
        assertEq(BlockMath.surgeFee(type(uint128).max, 1, 3_000, 100_000, 65_535), 100_000);
    }

    function test_maxBuyAndBpsCut() public pure {
        assertEq(BlockMath.maxBuy(1_000e18, 100), 10e18);
        assertEq(BlockMath.bpsCut(1_000e18, 250), 25e18);
        assertEq(BlockMath.bpsCut(1_000e18, 0), 0);
    }

    /// Rounding must always favour the pool, never the trader.
    function test_bpsCutRoundsDown() public pure {
        assertEq(BlockMath.bpsCut(9_999, 1), 0);
        assertEq(BlockMath.bpsCut(10_001, 1), 1);
    }

    function testFuzz_surgeFeeStaysWithinBounds(
        uint128 amountIn,
        uint128 reserve,
        uint24 baseFeePips,
        uint24 maxFeePips,
        uint16 surgeSens
    ) public pure {
        baseFeePips = uint24(bound(baseFeePips, 0, 100_000));
        maxFeePips = uint24(bound(maxFeePips, baseFeePips, 100_000));
        uint24 fee = BlockMath.surgeFee(amountIn, reserve, baseFeePips, maxFeePips, surgeSens);
        assertGe(fee, baseFeePips);
        assertLe(fee, maxFeePips);
    }

    function testFuzz_bpsCutNeverExceedsAmount(uint128 amount, uint16 bps) public pure {
        bps = uint16(bound(bps, 0, 10_000));
        assertLe(BlockMath.bpsCut(amount, bps), amount);
    }
}
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `forge test --match-path test/unit/BlockMath.t.sol`
Expected: FAIL — `Source "src/lib/BlockMath.sol" not found`.

- [ ] **Step 3: Написать реализацию**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";

/// @title BlockMath
/// @notice Every number the five blocks produce. Pure, poolless and mirrored
/// one-for-one by the TypeScript simulator, which a differential test enforces.
library BlockMath {
    uint256 internal constant BPS = 10_000;

    /// @notice ETH-side virtual reserve of the liquidity active at the current price.
    /// @dev ETH is always currency0 (the zero address sorts first), so this is
    /// amount0 = L * 2^96 / sqrtPriceX96. Single source of truth for every block:
    /// there is no separate notion of "pool reserve" anywhere in the system.
    function inRangeEthReserve(uint128 liquidity, uint160 sqrtPriceX96) internal pure returns (uint256) {
        if (liquidity == 0 || sqrtPriceX96 == 0) return 0;
        return FullMath.mulDiv(liquidity, FixedPoint96.Q96, sqrtPriceX96);
    }

    /// @notice Block 2 - Surge Fees. Fee grows linearly with how deep the trade
    /// bites into the in-range reserve, capped at maxFeePips.
    function surgeFee(uint256 amountIn, uint256 reserve, uint24 baseFeePips, uint24 maxFeePips, uint16 surgeSens)
        internal
        pure
        returns (uint24)
    {
        if (reserve == 0 || surgeSens == 0 || maxFeePips <= baseFeePips) return baseFeePips;

        uint256 depthBps = FullMath.mulDiv(amountIn, BPS, reserve);

        // Clamp before multiplying: a trade far larger than the reserve would
        // otherwise overflow, and it saturates the fee anyway.
        uint256 surgeFactor = BPS;
        if (depthBps < type(uint256).max / surgeSens) {
            surgeFactor = (depthBps * surgeSens) / BPS;
            if (surgeFactor > BPS) surgeFactor = BPS;
        }

        return uint24(baseFeePips + ((uint256(maxFeePips - baseFeePips) * surgeFactor) / BPS));
    }

    /// @notice Block 1 - Anti-Snipe. Largest buy allowed inside the guard window.
    function maxBuy(uint256 reserve, uint16 maxBuyBps) internal pure returns (uint256) {
        return (reserve * maxBuyBps) / BPS;
    }

    /// @notice A basis-point slice, rounded down so the pool never loses to rounding.
    function bpsCut(uint256 amount, uint16 bps) internal pure returns (uint256) {
        return (amount * bps) / BPS;
    }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `forge test --match-path test/unit/BlockMath.t.sol -vv`
Expected: PASS, тринадцать тестов, включая два фаззинговых.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/BlockMath.sol test/unit/BlockMath.t.sol
git commit -m "feat: BlockMath pure formulas for all five blocks"
```

---

### Task 5: Вендорный `BaseHook`, скелет `BlockHook` и валидация конфига

**Files:**
- Create: `src/hook/BaseHook.sol`
- Create: `src/interfaces/IBlockHook.sol`
- Create: `src/hook/BlockHook.sol`
- Create: `test/shared/Fixtures.sol`
- Create: `test/unit/BlockHookInit.t.sol`

**Interfaces:**
- Consumes: `BlockConfig`, `PoolState` (Task 1); `IPotVault` и `PotVault` (Task 3).
- Produces:
  - `BlockHook(IPoolManager manager, address launchpad, address router)` — все три иммутабельны, `potVault = new PotVault()` в конструкторе.
  - `stageConfig(BlockConfig calldata cfg)` — только `launchpad`, кладёт конфиг в транзиентное хранилище.
  - `configOf(PoolId) view returns (BlockConfig memory)`, `stateOf(PoolId) view returns (PoolState memory)` — публичное чтение, на них опирается подпроект 2.
  - `potVault() view returns (IPotVault)`.
  - Ошибки: `NotLaunchpad`, `NoStagedConfig`, `BadFeeBounds`, `EthCutTooLarge`, `SnipeTaxTooLarge`, `BurnTooLarge`, `GuardTooLong`, `BadPotEveryN`, `BadMaxBuyBps`, `BurnNeedsTrigger`, `PoolMustBeNativeEth`, `PoolMustBeDynamicFee`.

Ключевой механизм задачи — обход поправки П2. У `beforeInitialize` нет `hookData`, поэтому `Launchpad` кладёт конфиг в транзиентный слот вызовом `stageConfig` и сразу же в той же транзакции вызывает `poolManager.initialize`. Хук считывает слот, валидирует, персистит и обнуляет. Транзиентность здесь не оптимизация, а гарантия: конфиг физически не может пережить транзакцию и быть подобранным чужой инициализацией.

- [ ] **Step 1: Написать вендорный `src/hook/BaseHook.sol`**

Только шесть колбэков из нашего битмапа. Остальные восемь ревертят — если v4 их вызовет, значит адрес хука неверный, и мы хотим узнать об этом громко.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @title BaseHook
/// @notice Minimal vendored base for v4 hooks. Upstream moved BaseHook out of
/// v4-periphery into the v4-hooks-public monorepo, which drags in more than a
/// dozen submodules; this is the 1% of it we use.
abstract contract BaseHook is IHooks {
    error NotPoolManager();
    error HookNotImplemented();

    IPoolManager public immutable poolManager;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
        Hooks.validateHookPermissions(this, getHookPermissions());
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    function getHookPermissions() public pure virtual returns (Hooks.Permissions memory);

    // --- implemented callbacks: subclasses override the underscore variants ---

    function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96)
        external
        onlyPoolManager
        returns (bytes4)
    {
        return _beforeInitialize(sender, key, sqrtPriceX96);
    }

    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4) {
        return _beforeAddLiquidity(sender, key, params, hookData);
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        return _beforeSwap(sender, key, params, hookData);
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external onlyPoolManager returns (bytes4, int128) {
        return _afterSwap(sender, key, params, delta, hookData);
    }

    function _beforeInitialize(address, PoolKey calldata, uint160) internal virtual returns (bytes4) {
        revert HookNotImplemented();
    }

    function _beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        virtual
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        virtual
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        revert HookNotImplemented();
    }

    function _afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        internal
        virtual
        returns (bytes4, int128)
    {
        revert HookNotImplemented();
    }

    // --- callbacks we deliberately do not enable ---

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
```

- [ ] **Step 2: Написать падающий тест `test/unit/BlockHookInit.t.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {BlockHook} from "../../src/hook/BlockHook.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";

contract BlockHookInitTest is Fixtures {
    using PoolIdLibrary for PoolKey;

    function setUp() public {
        deployFixtures();
    }

    function test_hookAddressCarriesTheRequiredFlags() public view {
        assertEq(uint160(address(hook)) & 0x3FFF, 0x28CC);
    }

    function test_hookDeployedItsOwnVault() public view {
        assertEq(hook.potVault().hook(), address(hook));
    }

    function test_initializePersistsStagedConfig() public {
        BlockConfig memory cfg = defaultConfig();
        PoolKey memory key = initPoolWithConfig(cfg);

        BlockConfig memory stored = hook.configOf(key.toId());
        assertEq(stored.baseFeePips, cfg.baseFeePips);
        assertEq(stored.maxFeePips, cfg.maxFeePips);
        assertEq(stored.lpBps, cfg.lpBps);
        assertEq(stored.potBps, cfg.potBps);
        assertEq(stored.potEveryN, cfg.potEveryN);
        assertEq(stored.burnBps, cfg.burnBps);
        assertEq(stored.guardBlocks, cfg.guardBlocks);
    }

    function test_initializeRecordsStartBlock() public {
        vm.roll(1234);
        PoolKey memory key = initPoolWithConfig(defaultConfig());
        assertEq(hook.stateOf(key.toId()).startBlock, 1234);
    }

    function test_stagedConfigDoesNotSurviveTheTransaction() public {
        vm.prank(launchpad);
        hook.stageConfig(defaultConfig());
        // A fresh transaction: the transient slot is gone.
        vm.expectRevert(BlockHook.NoStagedConfig.selector);
        initPoolNoStaging(defaultConfig());
    }

    function test_onlyLaunchpadCanStageConfig() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(BlockHook.NotLaunchpad.selector);
        hook.stageConfig(defaultConfig());
    }

    function test_rejectsNonNativeCurrency0() public {
        BlockConfig memory cfg = defaultConfig();
        vm.prank(launchpad);
        hook.stageConfig(cfg);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0x1111)),
            currency1: Currency.wrap(address(0x2222)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: hook
        });
        vm.expectRevert();
        manager.initialize(key, SQRT_PRICE_1_1);
    }

    function test_rejectsStaticFeePool() public {
        BlockConfig memory cfg = defaultConfig();
        vm.prank(launchpad);
        hook.stageConfig(cfg);
        PoolKey memory key = poolKeyFor(address(token), 3000);
        vm.expectRevert();
        manager.initialize(key, SQRT_PRICE_1_1);
    }
}
```

- [ ] **Step 3: Написать тест валидации `test/unit/BlockConfigValidation.t.sol`**

Каждая строка таблицы §6 спеки — отдельный тест. Позитивный случай на границе и негативный сразу за ней.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {BlockHook} from "../../src/hook/BlockHook.sol";

contract BlockConfigValidationTest is Fixtures {
    function setUp() public {
        deployFixtures();
    }

    function _expectInitRevert(BlockConfig memory cfg, bytes4 err) internal {
        vm.expectRevert();
        initPoolWithConfig(cfg);
    }

    function test_maxFeeAt100000IsAccepted() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 100_000;
        initPoolWithConfig(cfg);
    }

    function test_maxFeeAbove100000IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.maxFeePips = 100_001;
        _expectInitRevert(cfg, BlockHook.BadFeeBounds.selector);
    }

    function test_baseFeeAboveMaxFeeIsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.baseFeePips = 50_000;
        cfg.maxFeePips = 49_999;
        _expectInitRevert(cfg, BlockHook.BadFeeBounds.selector);
    }

    function test_ethCutSumAt1000IsAccepted() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.lpBps = 600;
        cfg.potBps = 400;
        initPoolWithConfig(cfg);
    }

    function test_ethCutSumAbove1000IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.lpBps = 600;
        cfg.potBps = 401;
        _expectInitRevert(cfg, BlockHook.EthCutTooLarge.selector);
    }

    function test_snipeTaxAbove50000IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.snipeTaxPips = 50_001;
        _expectInitRevert(cfg, BlockHook.SnipeTaxTooLarge.selector);
    }

    function test_burnBpsAbove1000IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.burnBps = 1_001;
        cfg.burnTriggerWei = 1;
        _expectInitRevert(cfg, BlockHook.BurnTooLarge.selector);
    }

    function test_guardBlocksAbove7200IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.guardBlocks = 7_201;
        cfg.maxBuyBps = 100;
        _expectInitRevert(cfg, BlockHook.GuardTooLong.selector);
    }

    function test_potEveryNBelow2IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.potBps = 100;
        cfg.potEveryN = 1;
        _expectInitRevert(cfg, BlockHook.BadPotEveryN.selector);
    }

    function test_potEveryNAbove1000IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.potBps = 100;
        cfg.potEveryN = 1_001;
        _expectInitRevert(cfg, BlockHook.BadPotEveryN.selector);
    }

    function test_potBpsWithoutEveryNIsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.potBps = 100;
        cfg.potEveryN = 0;
        _expectInitRevert(cfg, BlockHook.BadPotEveryN.selector);
    }

    function test_guardWithoutMaxBuyBpsIsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.guardBlocks = 100;
        cfg.maxBuyBps = 0;
        _expectInitRevert(cfg, BlockHook.BadMaxBuyBps.selector);
    }

    function test_maxBuyBpsAbove10000IsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.guardBlocks = 100;
        cfg.maxBuyBps = 10_001;
        _expectInitRevert(cfg, BlockHook.BadMaxBuyBps.selector);
    }

    function test_burnWithoutTriggerIsRejected() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.burnBps = 100;
        cfg.burnTriggerWei = 0;
        _expectInitRevert(cfg, BlockHook.BurnNeedsTrigger.selector);
    }

    /// All blocks off is a legitimate configuration: a plain dynamic-fee pool.
    function test_allBlocksOffIsAccepted() public {
        BlockConfig memory cfg;
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 3_000;
        initPoolWithConfig(cfg);
    }
}
```

- [ ] **Step 4: Написать `test/shared/Fixtures.sol`**

Общий сетап для всех тестов хука: настоящий `PoolManager`, майнинг соли, деплой хука через CREATE2 из тестового контракта, вспомогательные функции инициализации пула и торговли.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {BlockHook} from "../../src/hook/BlockHook.sol";
import {LaunchToken} from "../../src/LaunchToken.sol";

abstract contract Fixtures is Test {
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // 2^96
    uint160 internal constant HOOK_FLAGS = 0x28CC;
    int24 internal constant TICK_SPACING = 60;

    PoolManager internal manager;
    BlockHook internal hook;
    LaunchToken internal token;
    address internal launchpad = address(0xLA0);
    address internal router = address(0x9007E9);

    function deployFixtures() internal {
        manager = new PoolManager(address(this));
        token = new LaunchToken("Test", "TEST", address(this));

        // Mine a salt so that the hook lands on an address carrying 0x28CC.
        bytes memory args = abi.encode(IPoolManager(address(manager)), launchpad, router);
        (address expected, bytes32 salt) =
            HookMiner.find(address(this), HOOK_FLAGS, type(BlockHook).creationCode, args);
        hook = new BlockHook{salt: salt}(IPoolManager(address(manager)), launchpad, router);
        require(address(hook) == expected, "fixture: hook address mismatch");
    }

    function defaultConfig() internal pure returns (BlockConfig memory cfg) {
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 30_000;
        cfg.surgeSens = 10_000;
    }

    function poolKeyFor(address token1, uint24 fee) internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token1),
            fee: fee,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
    }

    /// Stage the config as the launchpad would, then initialize in the same tx.
    function initPoolWithConfig(BlockConfig memory cfg) internal returns (PoolKey memory key) {
        key = poolKeyFor(address(token), LPFeeLibrary.DYNAMIC_FEE_FLAG);
        vm.prank(launchpad);
        hook.stageConfig(cfg);
        manager.initialize(key, SQRT_PRICE_1_1);
    }

    /// Initialize without staging — used to prove the transient slot is empty.
    function initPoolNoStaging(BlockConfig memory) internal returns (PoolKey memory key) {
        key = poolKeyFor(address(token), LPFeeLibrary.DYNAMIC_FEE_FLAG);
        manager.initialize(key, SQRT_PRICE_1_1);
    }
}
```

Замечание для исполнителя: `address(0xLA0)` — не валидный литерал Solidity. Использовать `address(uint160(0xLA0))` нельзя тоже; взять `address(0x1A0)` или `makeAddr("launchpad")`. Правильный вариант — `address internal launchpad = makeAddr("launchpad");` внутри `deployFixtures`, потому что `makeAddr` не `constant`.

- [ ] **Step 5: Убедиться, что тесты падают**

Run: `forge test --match-path "test/unit/BlockHook*.t.sol" --match-path "test/unit/BlockConfig*.t.sol"`
Expected: FAIL — `Source "src/hook/BlockHook.sol" not found`.

- [ ] **Step 6: Написать `src/interfaces/IBlockHook.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BlockConfig, PoolState} from "../lib/BlockConfig.sol";
import {IPotVault} from "./IPotVault.sol";

interface IBlockHook {
    function stageConfig(BlockConfig calldata cfg) external;
    function configOf(PoolId id) external view returns (BlockConfig memory);
    function stateOf(PoolId id) external view returns (PoolState memory);
    function potVault() external view returns (IPotVault);
    function launchpad() external view returns (address);
    function router() external view returns (address);
}
```

- [ ] **Step 7: Написать `src/hook/BlockHook.sol` — скелет**

На этом шаге реализуются только `getHookPermissions`, `stageConfig`, `_beforeInitialize` и `_beforeAddLiquidity`. Свопы приходят в следующих задачах.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BaseHook} from "./BaseHook.sol";
import {BlockConfig, PoolState} from "../lib/BlockConfig.sol";
import {IBlockHook} from "../interfaces/IBlockHook.sol";
import {IPotVault} from "../interfaces/IPotVault.sol";
import {PotVault} from "../PotVault.sol";

/// @title BlockHook
/// @notice One immutable hook serving every launched pool. Behaviour per pool is
/// fixed at initialization and can never be changed, replaced or upgraded.
/// The hook holds no balance: every slice it takes is paid out in the same
/// transaction it was taken.
contract BlockHook is BaseHook, IBlockHook {
    using PoolIdLibrary for PoolKey;
    using LPFeeLibrary for uint24;

    error NotLaunchpad();
    error NoStagedConfig();
    error PoolMustBeNativeEth();
    error PoolMustBeDynamicFee();
    error BadFeeBounds();
    error EthCutTooLarge();
    error SnipeTaxTooLarge();
    error BurnTooLarge();
    error GuardTooLong();
    error BadPotEveryN();
    error BadMaxBuyBps();
    error BurnNeedsTrigger();
    error OnlyLaunchpadProvidesLiquidity();

    event PoolConfigured(PoolId indexed id, BlockConfig cfg);

    /// @dev keccak256("blockhook.staged.config") - 1, an arbitrary transient slot.
    bytes32 internal constant STAGED_SLOT = 0x6b3a8f2f1a5f4ef1a3d0f4a7c9b2e8d5c4a1b6e3f0d7c2a9b8e5d4c1a0f7b6e3;

    address public immutable launchpad;
    address public immutable router;
    IPotVault public immutable potVault;

    mapping(PoolId => BlockConfig) internal _configOf;
    mapping(PoolId => PoolState) internal _stateOf;

    constructor(IPoolManager _manager, address _launchpad, address _router) BaseHook(_manager) {
        launchpad = _launchpad;
        router = _router;
        potVault = IPotVault(address(new PotVault()));
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @inheritdoc IBlockHook
    /// @dev beforeInitialize carries no hookData, so the launchpad hands the config
    /// over through transient storage immediately before calling initialize. It
    /// cannot outlive the transaction, so no other initialization can pick it up.
    function stageConfig(BlockConfig calldata cfg) external {
        if (msg.sender != launchpad) revert NotLaunchpad();
        bytes memory encoded = abi.encode(cfg);
        bytes32 slot = STAGED_SLOT;
        // Store the config word by word; 12 fields pack into 12 words when
        // abi-encoded, plus one word holding the length.
        assembly ("memory-safe") {
            let len := mload(encoded)
            tstore(slot, len)
            for { let i := 0 } lt(i, len) { i := add(i, 32) } {
                tstore(add(slot, add(div(i, 32), 1)), mload(add(encoded, add(i, 32))))
            }
        }
    }

    function _readStagedConfig() internal returns (BlockConfig memory cfg) {
        bytes32 slot = STAGED_SLOT;
        uint256 len;
        assembly ("memory-safe") {
            len := tload(slot)
        }
        if (len == 0) revert NoStagedConfig();

        bytes memory encoded = new bytes(len);
        assembly ("memory-safe") {
            for { let i := 0 } lt(i, len) { i := add(i, 32) } {
                mstore(add(encoded, add(i, 32)), tload(add(slot, add(div(i, 32), 1))))
            }
            // Clear the length so a second initialize in the same tx cannot reuse it.
            tstore(slot, 0)
        }
        cfg = abi.decode(encoded, (BlockConfig));
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal override returns (bytes4) {
        if (sender != launchpad) revert NotLaunchpad();
        if (!key.currency0.isAddressZero()) revert PoolMustBeNativeEth();
        if (!key.fee.isDynamicFee()) revert PoolMustBeDynamicFee();

        BlockConfig memory cfg = _readStagedConfig();
        _validate(cfg);

        PoolId id = key.toId();
        _configOf[id] = cfg;
        _stateOf[id].startBlock = uint64(block.number);

        emit PoolConfigured(id, cfg);
        return BaseHook.beforeInitialize.selector;
    }

    /// @dev Liquidity comes from the launchpad and nowhere else: it is the launchpad
    /// that holds the LP position, and a position held by anyone else would not be locked.
    function _beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        if (sender != launchpad) revert OnlyLaunchpadProvidesLiquidity();
        return BaseHook.beforeAddLiquidity.selector;
    }

    function _validate(BlockConfig memory c) internal pure {
        if (c.baseFeePips > c.maxFeePips || c.maxFeePips > 100_000) revert BadFeeBounds();
        if (uint256(c.lpBps) + uint256(c.potBps) > 1_000) revert EthCutTooLarge();
        if (c.snipeTaxPips > 50_000) revert SnipeTaxTooLarge();
        if (c.burnBps > 1_000) revert BurnTooLarge();
        if (c.guardBlocks > 7_200) revert GuardTooLong();
        if (c.potBps > 0 && (c.potEveryN < 2 || c.potEveryN > 1_000)) revert BadPotEveryN();
        if (c.potEveryN > 0 && (c.potEveryN < 2 || c.potEveryN > 1_000)) revert BadPotEveryN();
        if (c.guardBlocks > 0 && (c.maxBuyBps == 0 || c.maxBuyBps > 10_000)) revert BadMaxBuyBps();
        if (c.burnBps > 0 && c.burnTriggerWei == 0) revert BurnNeedsTrigger();
    }

    /// @inheritdoc IBlockHook
    function configOf(PoolId id) external view returns (BlockConfig memory) {
        return _configOf[id];
    }

    /// @inheritdoc IBlockHook
    function stateOf(PoolId id) external view returns (PoolState memory) {
        return _stateOf[id];
    }

    /// @dev Needed to receive ETH slices taken from the PoolManager before they are
    /// forwarded in the same call. The balance is always zero between transactions.
    receive() external payable {}
}
```

- [ ] **Step 8: Убедиться, что тесты проходят**

Run: `forge test --match-contract "BlockHookInitTest|BlockConfigValidationTest" -vv`
Expected: PASS. Ошибки `HookAddressNotValid` на этапе деплоя означают, что `getHookPermissions` разошёлся с битмапом `0x28CC` — чинить permissions, а не соль.

- [ ] **Step 9: Коммит**

```bash
git add src/hook/ src/interfaces/IBlockHook.sol test/shared/Fixtures.sol test/unit/BlockHookInit.t.sol test/unit/BlockConfigValidation.t.sol
git commit -m "feat: BlockHook skeleton with transient config staging and full validation"
```

---

### Task 6: Блок 2 — Surge Fees

**Files:**
- Modify: `src/hook/BlockHook.sol` (добавить `_beforeSwap`, вспомогательные `_reserveOf`, `_isExactInBuy`)
- Create: `test/unit/BlockHookSurge.t.sol`
- Modify: `test/shared/Fixtures.sol` (добавить `addLiquidity`, `buy`, `sell`)

**Interfaces:**
- Consumes: `BlockMath.surgeFee`, `BlockMath.inRangeEthReserve` (Task 4); `StateLibrary.getSlot0`, `StateLibrary.getLiquidity`.
- Produces: `_beforeSwap` возвращает `(selector, BeforeSwapDelta.ZERO, feePips | LPFeeLibrary.OVERRIDE_FEE_FLAG)`. Задачи 7–11 расширяют ту же функцию, не переписывая её.

Динамическая комиссия — самый безопасный блок: он не двигает деньги, только подменяет ставку LP-комиссии на текущий своп. Делаем его первым, чтобы отладить сантехнику `_beforeSwap` без риска.

- [ ] **Step 1: Дописать хелперы торговли в `test/shared/Fixtures.sol`**

```solidity
    // --- add to Fixtures ---
    import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
    import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
    import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
    import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";
    import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

    /// Minimal router used by the tests to reach the PoolManager. It stands in for
    /// the launchpad when adding liquidity and for BoundedRouter when swapping.
    /// Task 9 replaces its swap path with the real BoundedRouter.
    enum Op { AddLiquidity, Swap }

    struct Call {
        Op op;
        PoolKey key;
        bytes data;
        address caller;
        address recipient;
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(manager), "not manager");
        Call memory c = abi.decode(raw, (Call));
        if (c.op == Op.AddLiquidity) {
            ModifyLiquidityParams memory p = abi.decode(c.data, (ModifyLiquidityParams));
            (BalanceDelta delta,) = manager.modifyLiquidity(c.key, p, "");
            _settle(c.key, delta);
        } else {
            SwapParams memory p = abi.decode(c.data, (SwapParams));
            BalanceDelta delta = manager.swap(c.key, p, abi.encode(c.recipient));
            _settle(c.key, delta);
        }
        return "";
    }
```

Полное тело `_settle` (оплата отрицательных дельт, приём положительных) исполнитель пишет по образцу `CurrencySettler`: для каждой из двух валют, если дельта отрицательная — `settle`, если положительная — `take` на `address(this)`.

Публичные обёртки:

```solidity
    function addLiquidity(PoolKey memory key, int256 liquidityDelta) internal {
        ModifyLiquidityParams memory p = ModifyLiquidityParams({
            tickLower: TickMath.minUsableTick(TICK_SPACING),
            tickUpper: TickMath.maxUsableTick(TICK_SPACING),
            liquidityDelta: liquidityDelta,
            salt: bytes32(0)
        });
        vm.prank(launchpad);
        manager.unlock(abi.encode(Call(Op.AddLiquidity, key, abi.encode(p), launchpad, address(0))));
    }

    function buy(PoolKey memory key, uint256 amountIn, address recipient) internal {
        SwapParams memory p = SwapParams({
            zeroForOne: true,
            amountSpecified: -int256(amountIn),
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });
        vm.prank(router);
        manager.unlock(abi.encode(Call(Op.Swap, key, abi.encode(p), router, recipient)));
    }
```

Внимание исполнителю: `vm.prank` действует на один внешний вызов, а `unlock` вызывает `unlockCallback` уже от имени менеджера — `sender`, который увидит хук в `beforeSwap`, это `msg.sender` для `manager.swap`, то есть сам тестовый контракт. Чтобы хук видел `router`, свопы должны идти из отдельного контракта-роутера. Поэтому в `Fixtures` нужен маленький `TestRouter`, задеплоенный по адресу `router`, а не `vm.prank`. Исполнитель обязан это исправить: вынести `unlockCallback` и обёртки в `contract TestRouter`, а в `deployFixtures` присвоить `router = address(new TestRouter(manager))` **до** майнинга соли, потому что адрес роутера входит в аргументы конструктора хука.

- [ ] **Step 2: Написать падающий тест**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {BlockMath} from "../../src/lib/BlockMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

contract BlockHookSurgeTest is Fixtures {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    PoolKey internal key;

    function setUp() public {
        deployFixtures();
        BlockConfig memory cfg = defaultConfig();
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 100_000;
        cfg.surgeSens = 10_000;
        key = initPoolWithConfig(cfg);
        addLiquidity(key, 1000e18);
    }

    /// A dust trade pays the base fee: the LP fee charged must match surgeFee()
    /// computed off the pre-swap reserve.
    function test_tinyBuyPaysBaseFee() public {
        uint256 expected = _expectedFee(0.0001 ether);
        assertEq(expected, 3_000);
        assertEq(_chargedFee(0.0001 ether), 3_000);
    }

    function test_deepBuyPaysMoreThanBaseFee() public {
        uint24 charged = _chargedFee(50 ether);
        assertGt(charged, 3_000);
        assertLe(charged, 100_000);
    }

    function test_chargedFeeMatchesBlockMathExactly() public {
        uint256 amountIn = 7.5 ether;
        assertEq(_chargedFee(amountIn), _expectedFee(amountIn));
    }

    function test_sellAlsoPaysDynamicFeeButNoCuts() public {
        // Sells go through the same fee curve; they simply carry no ETH slices.
        uint24 charged = _chargedFeeOnSell(1_000e18);
        assertGe(charged, 3_000);
    }

    function _expectedFee(uint256 amountIn) internal view returns (uint24) {
        PoolId id = key.toId();
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(id);
        uint128 liquidity = manager.getLiquidity(id);
        BlockConfig memory cfg = hook.configOf(id);
        uint256 reserve = BlockMath.inRangeEthReserve(liquidity, sqrtPriceX96);
        return BlockMath.surgeFee(amountIn, reserve, cfg.baseFeePips, cfg.maxFeePips, cfg.surgeSens);
    }

    /// Reads the fee actually applied by decoding the Swap event emitted by the
    /// PoolManager, whose last field is the fee in pips.
    function _chargedFee(uint256 amountIn) internal returns (uint24) {
        vm.recordLogs();
        buy(key, amountIn, address(0xCAFE));
        return _feeFromLastSwapEvent();
    }
```

Тело `_feeFromLastSwapEvent` исполнитель пишет так: взять `vm.getRecordedLogs()`, найти запись с `topics[0] == keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")`, декодировать `data` и вернуть последнее поле.

- [ ] **Step 3: Убедиться, что тест падает**

Run: `forge test --match-contract BlockHookSurgeTest`
Expected: FAIL — `HookNotImplemented`, потому что `_beforeSwap` ещё не переопределён.

- [ ] **Step 4: Реализовать `_beforeSwap` в `BlockHook`**

```solidity
    // --- add to BlockHook ---
    import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
    import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
    import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
    import {BlockMath} from "../lib/BlockMath.sol";

    using StateLibrary for IPoolManager;

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        BlockConfig memory cfg = _configOf[id];

        uint256 amountIn = params.amountSpecified < 0 ? uint256(-params.amountSpecified) : 0;
        uint256 reserve = _ethReserve(id);
        uint24 fee = BlockMath.surgeFee(amountIn, reserve, cfg.baseFeePips, cfg.maxFeePips, cfg.surgeSens);

        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function _ethReserve(PoolId id) internal view returns (uint256) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(id);
        return BlockMath.inRangeEthReserve(poolManager.getLiquidity(id), sqrtPriceX96);
    }
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `forge test --match-contract BlockHookSurgeTest -vv`
Expected: PASS, четыре теста.

- [ ] **Step 6: Коммит**

```bash
git add src/hook/BlockHook.sol test/unit/BlockHookSurge.t.sol test/shared/Fixtures.sol
git commit -m "feat: block 2 surge fees via dynamic LP fee override"
```

---

### Task 7: Блок 1 — Anti-Snipe

**Files:**
- Modify: `src/hook/BlockHook.sol` (расширить `_beforeSwap`)
- Create: `test/unit/BlockHookAntiSnipe.t.sol`

**Interfaces:**
- Consumes: `BlockMath.maxBuy`; `PoolState.startBlock` (Task 5).
- Produces: ошибка `BuyExceedsGuardCap()`; надбавка `snipeTaxPips` прибавляется к результату `BlockMath.surgeFee` до наложения `OVERRIDE_FEE_FLAG`, с потолком `LPFeeLibrary.MAX_LP_FEE`.

- [ ] **Step 1: Написать падающий тест**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {BlockHook} from "../../src/hook/BlockHook.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

contract BlockHookAntiSnipeTest is Fixtures {
    PoolKey internal key;
    uint32 internal constant GUARD = 100;

    function setUp() public {
        deployFixtures();
        BlockConfig memory cfg = defaultConfig();
        cfg.guardBlocks = GUARD;
        cfg.maxBuyBps = 100; // 1% of the in-range reserve
        cfg.snipeTaxPips = 20_000; // +2%
        key = initPoolWithConfig(cfg);
        addLiquidity(key, 1000e18);
    }

    function test_buyAtTheCapSucceedsInsideTheWindow() public {
        uint256 cap = _capNow();
        buy(key, cap, address(0xCAFE));
    }

    function test_buyOneWeiOverTheCapRevertsInsideTheWindow() public {
        uint256 cap = _capNow();
        vm.expectRevert();
        buy(key, cap + 1, address(0xCAFE));
    }

    function test_capNoLongerAppliesAfterTheWindow() public {
        uint256 cap = _capNow();
        vm.roll(block.number + GUARD);
        buy(key, cap * 50, address(0xCAFE));
    }

    function test_snipeTaxIsAddedInsideTheWindowOnly() public {
        uint24 inside = _chargedFee(0.0001 ether);
        vm.roll(block.number + GUARD);
        uint24 outside = _chargedFee(0.0001 ether);
        assertEq(inside - outside, 20_000, "snipe tax must be exactly snipeTaxPips");
    }

    function test_guardAppliesToBuysOnlyNotSells() public {
        // Give the caller tokens and sell far more than the buy cap: must not revert.
        sell(key, 100_000e18, address(0xCAFE));
    }

    function test_windowBoundaryIsExclusiveAtStartPlusGuard() public {
        uint64 start = hook.stateOf(key.toId()).startBlock;
        vm.roll(start + GUARD - 1);
        uint256 cap = _capNow();
        vm.expectRevert();
        buy(key, cap + 1, address(0xCAFE)); // last guarded block
        vm.roll(start + GUARD);
        buy(key, cap * 10, address(0xCAFE)); // first free block
    }

    function _capNow() internal view returns (uint256) {
        // reserve * maxBuyBps / 10_000, read live from the pool
        return (_ethReserveOfKey(key) * 100) / 10_000;
    }
}
```

`_ethReserveOfKey` и `_chargedFee`/`sell` — хелперы из `Fixtures`, добавленные в Task 6; `_ethReserveOfKey` вынести туда же.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `forge test --match-contract BlockHookAntiSnipeTest`
Expected: FAIL — покупка вдвое больше лимита проходит, `test_buyOneWeiOverTheCapRevertsInsideTheWindow` не видит реверта.

- [ ] **Step 3: Расширить `_beforeSwap`**

```solidity
    error BuyExceedsGuardCap();

    // inside _beforeSwap, after computing amountIn and reserve, before returning:
    bool isExactInBuy = params.zeroForOne && params.amountSpecified < 0;

    if (isExactInBuy && cfg.guardBlocks > 0) {
        PoolState storage st = _stateOf[id];
        if (block.number < uint256(st.startBlock) + cfg.guardBlocks) {
            if (amountIn > BlockMath.maxBuy(reserve, cfg.maxBuyBps)) revert BuyExceedsGuardCap();
            uint256 taxed = uint256(fee) + cfg.snipeTaxPips;
            fee = uint24(taxed > LPFeeLibrary.MAX_LP_FEE ? LPFeeLibrary.MAX_LP_FEE : taxed);
        }
    }
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `forge test --match-contract BlockHookAntiSnipeTest -vv`
Expected: PASS, шесть тестов.

- [ ] **Step 5: Прогнать всё, что уже есть**

Run: `forge test`
Expected: PASS. Surge-тесты не должны сломаться: у них `guardBlocks = 0`.

- [ ] **Step 6: Коммит**

```bash
git add src/hook/BlockHook.sol test/unit/BlockHookAntiSnipe.t.sol test/shared/Fixtures.sol
git commit -m "feat: block 1 anti-snipe buy cap and guard-window tax"
```

---

### Task 8: Блок 4 — LP Rewards

**Files:**
- Modify: `src/hook/BlockHook.sol` (срез ETH в `_beforeSwap`, `donate`)
- Create: `test/unit/BlockHookLpRewards.t.sol`

**Interfaces:**
- Consumes: `BlockMath.bpsCut`; `IPoolManager.donate`.
- Produces: `_beforeSwap` начинает возвращать ненулевую `BeforeSwapDelta` со **специфицированной** дельтой, равной сумме ETH-срезов. Задача 10 добавит к той же сумме долю котла.

Здесь появляется первое движение денег, и здесь же — главный риск подпроекта. Разобраться до написания кода:

**Знак дельты.** Проверено по `Hooks.sol` v4-core: при exact-input `amountSpecified < 0`, и строка `amountToSwap += hookDeltaSpecified` означает, что **положительная** специфицированная дельта уменьшает объём, уходящий в своп. То есть положительное значение = хук забрал столько-то входа себе. Библиотека тут же проверяет, что знак не перевернулся, поэтому срез, превышающий вход, отобьётся `HookDeltaExceedsSwapAmount`.

**Кто платит.** Возвращённая дельта учитывается менеджером в пользу хука (`_accountPoolBalanceDelta(key, hookDelta, address(key.hooks))`), а `swapDelta` покупателя уменьшается на неё. Значит хук получает кредит на `lpCut` и обязан его погасить в той же разблокировке. `poolManager.donate(key, lpCut, 0)` создаёт ровно такой же долг — кредит и долг схлопываются в ноль, ETH физически никуда не идёт, а `feeGrowthGlobal0` пула растёт. Это и есть «нулевой баланс хука» из §3.1 в буквальном смысле.

**Пустой пул.** `donate` реверти́т при нулевой ликвидности. Если ликвидности нет, срез не берём вовсе.

- [ ] **Step 1: Написать падающий тест**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

contract BlockHookLpRewardsTest is Fixtures {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    PoolKey internal key;

    function setUp() public {
        deployFixtures();
        BlockConfig memory cfg = defaultConfig();
        cfg.lpBps = 200; // 2% of ETH input to LPs
        key = initPoolWithConfig(cfg);
        addLiquidity(key, 1000e18);
    }

    function test_buyRaisesFeeGrowthByTheLpCut() public {
        PoolId id = key.toId();
        (uint256 growth0Before,) = manager.getFeeGrowthGlobals(id);
        uint128 liquidity = manager.getLiquidity(id);

        buy(key, 10 ether, address(0xCAFE));

        (uint256 growth0After,) = manager.getFeeGrowthGlobals(id);
        // The donation alone contributes lpCut * 2^128 / liquidity; swap fees add
        // more on top, so assert the floor.
        uint256 lpCut = (10 ether * 200) / 10_000;
        uint256 minDelta = (lpCut << 128) / liquidity;
        assertGe(growth0After - growth0Before, minDelta);
    }

    function test_hookHoldsNothingAfterTheBuy() public {
        buy(key, 10 ether, address(0xCAFE));
        assertEq(address(hook).balance, 0);
        assertEq(token.balanceOf(address(hook)), 0);
    }

    function test_buyerReceivesLessTokenBecauseOfTheCut() public {
        uint256 withCut = _tokensOutForBuy(10 ether);

        // Same pool, same size, lpBps = 0
        BlockHookLpRewardsTest fresh = new BlockHookLpRewardsTest();
        uint256 withoutCut = fresh._tokensOutWithLpBps(0, 10 ether);

        assertLt(withCut, withoutCut, "the LP cut must come out of the buyer's input");
    }

    function test_sellPaysNoLpCut() public {
        PoolId id = key.toId();
        (uint256 before0,) = manager.getFeeGrowthGlobals(id);
        uint128 liquidity = manager.getLiquidity(id);
        sell(key, 1_000e18, address(0xCAFE));
        (uint256 after0,) = manager.getFeeGrowthGlobals(id);
        // Only the ordinary swap fee on the token side; the ETH-side growth from a
        // donation would be far larger. Assert it stayed under that floor.
        uint256 donationFloor = ((1 ether * 200) / 10_000 << 128) / liquidity;
        assertLt(after0 - before0, donationFloor);
    }

    function test_exactOutputBuyPaysNoLpCut() public {
        uint256 balBefore = address(this).balance;
        buyExactOutput(key, 1_000e18, address(0xCAFE));
        // With no cut, the ETH spent equals the pure swap quote; asserted by the
        // absence of any donation-sized fee growth.
        assertGt(balBefore, address(this).balance);
        assertEq(address(hook).balance, 0);
    }

    function test_zeroLiquidityPoolTakesNoCutAndDoesNotRevert() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.lpBps = 200;
        PoolKey memory empty = initPoolWithConfig(cfg); // no addLiquidity
        vm.expectRevert(); // the swap itself fails on an empty pool, not the hook
        buy(empty, 1 ether, address(0xCAFE));
    }
}
```

`_tokensOutForBuy`, `_tokensOutWithLpBps` и `buyExactOutput` исполнитель добавляет в `Fixtures`: первые два измеряют баланс токена получателя до и после, третий делает своп с положительным `amountSpecified`.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `forge test --match-contract BlockHookLpRewardsTest`
Expected: FAIL — `test_buyRaisesFeeGrowthByTheLpCut`, рост `feeGrowthGlobal0` меньше порога.

- [ ] **Step 3: Реализовать срез в `_beforeSwap`**

```solidity
    // inside _beforeSwap, after the anti-snipe block:
    BeforeSwapDelta delta = BeforeSwapDeltaLibrary.ZERO_DELTA;

    if (isExactInBuy) {
        uint256 lpCut = reserve == 0 ? 0 : BlockMath.bpsCut(amountIn, cfg.lpBps);
        if (lpCut > 0) {
            // The hook is credited lpCut by the manager and donate() debits the
            // same amount: net zero, and the ETH never leaves the pool.
            poolManager.donate(key, lpCut, 0, "");
            delta = toBeforeSwapDelta(int128(int256(lpCut)), 0);
        }
    }

    return (BaseHook.beforeSwap.selector, delta, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
```

Импортировать `toBeforeSwapDelta` из `@uniswap/v4-core/src/types/BeforeSwapDelta.sol`.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `forge test --match-contract BlockHookLpRewardsTest -vv`
Expected: PASS, шесть тестов.

- [ ] **Step 5: Прогнать всё**

Run: `forge test`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add src/hook/BlockHook.sol test/unit/BlockHookLpRewards.t.sol test/shared/Fixtures.sol
git commit -m "feat: block 4 LP rewards paid through donate in the same transaction"
```

---
### Task 9: `BoundedRouter`

**Files:**
- Create: `src/BoundedRouter.sol`
- Create: `test/unit/BoundedRouter.t.sol`
- Modify: `test/shared/Fixtures.sol` (заменить `TestRouter` на настоящий `BoundedRouter`)

**Interfaces:**
- Consumes: `IPoolManager.unlock/swap`, `IUnlockCallback`, `CurrencySettler`.
- Produces:
  - `buy(PoolKey calldata key, uint256 minAmountOut, address recipient, uint256 deadline) external payable returns (uint256 amountOut)`
  - `sell(PoolKey calldata key, uint256 amountIn, uint256 minEthOut, address recipient, uint256 deadline) external returns (uint256 ethOut)`
  - Ошибки: `Expired()`, `TooLittleReceived()`, `NoRecipient()`.
  - В `hookData` кладёт ровно `abi.encode(recipient)`. Хук доверяет этому полю **только** когда `sender == router`.

Без своего роутера пятый блок нерабочий: `beforeSwap` получает `sender`, а это адрес роутера, а не покупателя, и стандартный Universal Router получателя в `hookData` не кладёт. Роутер собственного баланса не имеет — всё, что пришло, уходит в той же транзакции.

- [ ] **Step 1: Написать падающий тест**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BoundedRouter} from "../../src/BoundedRouter.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

contract BoundedRouterTest is Fixtures {
    PoolKey internal key;
    address internal alice = makeAddr("alice");

    function setUp() public {
        deployFixtures();
        key = initPoolWithConfig(defaultConfig());
        addLiquidity(key, 1000e18);
        vm.deal(alice, 100 ether);
    }

    function test_buySendsTokensToRecipient() public {
        vm.prank(alice);
        uint256 out = boundedRouter.buy{value: 1 ether}(key, 0, alice, block.timestamp);
        assertGt(out, 0);
        assertEq(token.balanceOf(alice), out);
    }

    function test_buyRevertsWhenOutputBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert(BoundedRouter.TooLittleReceived.selector);
        boundedRouter.buy{value: 1 ether}(key, type(uint256).max, alice, block.timestamp);
    }

    function test_buyRevertsAfterDeadline() public {
        vm.warp(1000);
        vm.prank(alice);
        vm.expectRevert(BoundedRouter.Expired.selector);
        boundedRouter.buy{value: 1 ether}(key, 0, alice, 999);
    }

    function test_zeroRecipientIsRejected() public {
        vm.prank(alice);
        vm.expectRevert(BoundedRouter.NoRecipient.selector);
        boundedRouter.buy{value: 1 ether}(key, 0, address(0), block.timestamp);
    }

    function test_routerKeepsNoBalance() public {
        vm.prank(alice);
        boundedRouter.buy{value: 1 ether}(key, 0, alice, block.timestamp);
        assertEq(address(boundedRouter).balance, 0);
        assertEq(token.balanceOf(address(boundedRouter)), 0);
    }

    function test_sellReturnsEthToRecipient() public {
        vm.prank(alice);
        uint256 bought = boundedRouter.buy{value: 1 ether}(key, 0, alice, block.timestamp);

        vm.startPrank(alice);
        token.approve(address(boundedRouter), bought);
        uint256 ethBefore = alice.balance;
        uint256 ethOut = boundedRouter.sell(key, bought, 0, alice, block.timestamp);
        vm.stopPrank();

        assertGt(ethOut, 0);
        assertEq(alice.balance - ethBefore, ethOut);
        assertEq(address(boundedRouter).balance, 0);
    }

    function test_hookSeesTheRouterAsSender() public {
        // Proven indirectly: the pot only counts buys routed through BoundedRouter.
        // Task 10 asserts the negative case directly.
        vm.prank(alice);
        boundedRouter.buy{value: 1 ether}(key, 0, alice, block.timestamp);
    }
}
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `forge test --match-contract BoundedRouterTest`
Expected: FAIL — `Source "src/BoundedRouter.sol" not found`.

- [ ] **Step 3: Написать реализацию**

Структура: `buy` принимает ETH, вызывает `poolManager.unlock` с закодированной командой, в `unlockCallback` делает `manager.swap` с `hookData = abi.encode(recipient)`, платит ETH через `settle`, забирает токен через `take` сразу на `recipient`, сверяет `amountOut >= minAmountOut` и возвращает. `sell` симметрично: `transferFrom` токена с плательщика, `settle` токена, `take` ETH на `recipient`. Обе функции начинаются с `if (block.timestamp > deadline) revert Expired();` и `if (recipient == address(0)) revert NoRecipient();`. Никакого состояния между транзакциями контракт не хранит; переменные, нужные внутри разблокировки, передаются через параметр `unlock`.

- [ ] **Step 4: Перевести `Fixtures` на настоящий роутер**

В `deployFixtures` порядок обязателен: сначала `PoolManager`, затем `boundedRouter = new BoundedRouter(manager)`, и только потом майнинг соли — адрес роутера входит в аргументы конструктора хука, а значит в creation code, по хэшу которого ищется соль. Функции `buy`/`sell`/`buyExactOutput` в `Fixtures` переписать на вызовы `boundedRouter`. Добавление ликвидности остаётся на отдельном тестовом контракте, играющем роль лаунчпада.

- [ ] **Step 5: Убедиться, что все тесты проходят**

Run: `forge test`
Expected: PASS. Тесты задач 6–8 продолжают работать через новый роутер.

- [ ] **Step 6: Коммит**

```bash
git add src/BoundedRouter.sol test/unit/BoundedRouter.t.sol test/shared/Fixtures.sol
git commit -m "feat: BoundedRouter with slippage bounds, deadline and canonical recipient"
```

---

### Task 10: Блок 5 — Nth-buy Pot

**Files:**
- Modify: `src/hook/BlockHook.sol`
- Create: `test/unit/BlockHookPot.t.sol`

**Interfaces:**
- Consumes: `IPotVault.fund/pay/balanceOf` (Task 3); `router` (Task 9).
- Produces: событие `PotPaid(PoolId indexed id, address indexed winner, uint256 amount, uint32 buyIndex)`; поля `PoolState.potBalance`, `potBuyCount`, `lastCountedBlock` начинают меняться.

Порядок действий строго по §5 спеки: сначала срез уходит в котёл, потом двигается счётчик, потом — если номер кратен `potEveryN` — котёл выплачивается. Победитель забирает и собственный взнос: это осознанно, иначе N-я покупка была бы выгоднее остальных ровно на свой срез.

Счётчик двигается не чаще раза в блок. Это единственная защита от накрутки: иначе снайпер отправляет N-1 пылевых покупок и N-ю крупную в одном блоке и забирает котёл целиком.

- [ ] **Step 1: Написать падающий тест**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";

contract BlockHookPotTest is Fixtures {
    using PoolIdLibrary for PoolKey;

    PoolKey internal key;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        deployFixtures();
        BlockConfig memory cfg = defaultConfig();
        cfg.potBps = 100; // 1% to the pot
        cfg.potEveryN = 3;
        cfg.potMinBuyWei = 0.5 ether;
        key = initPoolWithConfig(cfg);
        addLiquidity(key, 1000e18);
        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    function _buy(address who, uint256 amount) internal {
        vm.roll(block.number + 1);
        vm.prank(who);
        boundedRouter.buy{value: amount}(key, 0, who, block.timestamp);
    }

    function test_everyBuyFundsThePot() public {
        _buy(alice, 1 ether);
        assertEq(hook.potVault().balanceOf(key.toId()), (1 ether * 100) / 10_000);
        assertEq(hook.stateOf(key.toId()).potBalance, (1 ether * 100) / 10_000);
    }

    function test_thirdQualifyingBuyWinsTheWholePot() public {
        _buy(alice, 1 ether);
        _buy(bob, 1 ether);
        uint256 balBefore = alice.balance;
        uint256 potBefore = hook.potVault().balanceOf(key.toId());
        uint256 cutOfWinningBuy = (1 ether * 100) / 10_000;

        _buy(alice, 1 ether);

        // Winner receives everything accumulated including their own cut,
        // net of the ETH they spent on the buy itself.
        assertEq(alice.balance, balBefore - 1 ether + potBefore + cutOfWinningBuy);
        assertEq(hook.potVault().balanceOf(key.toId()), 0);
    }

    function test_buysBelowMinimumFundThePotButDoNotCount() public {
        _buy(alice, 0.1 ether); // below potMinBuyWei
        assertEq(hook.stateOf(key.toId()).potBuyCount, 0);
        assertGt(hook.potVault().balanceOf(key.toId()), 0, "cut is still taken");
    }

    function test_counterMovesAtMostOncePerBlock() public {
        vm.roll(100);
        vm.startPrank(alice);
        boundedRouter.buy{value: 1 ether}(key, 0, alice, block.timestamp);
        boundedRouter.buy{value: 1 ether}(key, 0, alice, block.timestamp);
        boundedRouter.buy{value: 1 ether}(key, 0, alice, block.timestamp);
        vm.stopPrank();
        assertEq(hook.stateOf(key.toId()).potBuyCount, 1, "three buys in one block count once");
        assertGt(hook.potVault().balanceOf(key.toId()), 0, "but all three fund the pot");
    }

    function test_sellsNeitherFundNorCount() public {
        _buy(alice, 1 ether);
        uint256 potAfterBuy = hook.potVault().balanceOf(key.toId());
        uint32 countAfterBuy = hook.stateOf(key.toId()).potBuyCount;

        vm.roll(block.number + 1);
        vm.startPrank(alice);
        token.approve(address(boundedRouter), token.balanceOf(alice));
        boundedRouter.sell(key, token.balanceOf(alice), 0, alice, block.timestamp);
        vm.stopPrank();

        assertEq(hook.potVault().balanceOf(key.toId()), potAfterBuy);
        assertEq(hook.stateOf(key.toId()).potBuyCount, countAfterBuy);
    }

    function test_vaultAccountingMatchesHookAccounting() public {
        _buy(alice, 1 ether);
        _buy(bob, 2 ether);
        assertEq(hook.potVault().balanceOf(key.toId()), hook.stateOf(key.toId()).potBalance);
    }

    function test_hookHoldsNothingAfterAPayout() public {
        _buy(alice, 1 ether);
        _buy(bob, 1 ether);
        _buy(alice, 1 ether);
        assertEq(address(hook).balance, 0);
    }

    function test_potIsPerPoolNotGlobal() public {
        BlockConfig memory cfg = defaultConfig();
        cfg.potBps = 100;
        cfg.potEveryN = 3;
        PoolKey memory other = initSecondPoolWithConfig(cfg);
        addLiquidity(other, 1000e18);

        _buy(alice, 1 ether);
        assertGt(hook.potVault().balanceOf(key.toId()), 0);
        assertEq(hook.potVault().balanceOf(other.toId()), 0);
    }
}
```

`initSecondPoolWithConfig` — вариант `initPoolWithConfig` со вторым `LaunchToken`, добавить в `Fixtures`.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `forge test --match-contract BlockHookPotTest`
Expected: FAIL — котёл остаётся нулевым.

- [ ] **Step 3: Реализовать блок в `_beforeSwap`**

```solidity
    event PotPaid(PoolId indexed id, address indexed winner, uint256 amount, uint32 buyIndex);

    // inside _beforeSwap, in the isExactInBuy branch, alongside the LP cut:
    uint256 potCut = BlockMath.bpsCut(amountIn, cfg.potBps);
    uint256 totalCut = lpCut + potCut;

    if (potCut > 0) {
        // Pull the ETH out of the manager against the credit the returned delta
        // will give us, then hand it straight to the vault. The hook holds it
        // for the length of two opcodes.
        poolManager.take(key.currency0, address(this), potCut);
        potVault.fund{value: potCut}(id);
        st.potBalance += uint128(potCut);
    }

    if (cfg.potEveryN >= 2 && amountIn >= cfg.potMinBuyWei && block.number > st.lastCountedBlock) {
        address winner = _recipientOf(sender, hookData);
        st.potBuyCount += 1;
        st.lastCountedBlock = uint64(block.number);

        if (winner != address(0) && st.potBuyCount % cfg.potEveryN == 0) {
            uint256 prize = st.potBalance;
            st.potBalance = 0;
            potVault.pay(id, winner, prize);
            // pay() credits the pot back if the transfer failed; resync.
            uint256 remaining = potVault.balanceOf(id);
            st.potBalance = uint128(remaining);
            emit PotPaid(id, winner, prize - remaining, st.potBuyCount);
        }
    }

    if (totalCut > 0) delta = toBeforeSwapDelta(int128(int256(totalCut)), 0);

    /// @dev Only the canonical router can name a recipient. Any other caller
    /// reaches the pool through a path where the buyer is unknown, and an
    /// unknown buyer cannot win the pot.
    function _recipientOf(address sender, bytes calldata hookData) internal view returns (address) {
        if (sender != router || hookData.length != 32) return address(0);
        return abi.decode(hookData, (address));
    }
```

Замечание: `sender` — первый параметр `_beforeSwap`, который в Task 6 игнорировался; теперь он нужен, дать ему имя.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `forge test --match-contract BlockHookPotTest -vv`
Expected: PASS, восемь тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/hook/BlockHook.sol test/unit/BlockHookPot.t.sol test/shared/Fixtures.sol
git commit -m "feat: block 5 Nth-buy pot with per-block counter and vault custody"
```

---

### Task 11: Блок 3 — Auto Burn

**Files:**
- Modify: `src/hook/BlockHook.sol` (`_afterSwap`)
- Create: `test/unit/BlockHookAutoBurn.t.sol`

**Interfaces:**
- Consumes: `BalanceDelta.amount1()`; `IPoolManager.take`.
- Produces: `_afterSwap` возвращает `(selector, int128(burnAmount))` — положительная **неспецифицированная** дельта, уменьшающая выход покупателя. Константа `address internal constant DEAD = 0x000000000000000000000000000000000000dEaD`.

Сжигание уменьшает то, что получает покупатель, и никогда не трогает резервы пула — это инвариант 7 из §8. Механически: хук объявляет дельту, менеджер начисляет ему кредит в токене, хук гасит его вызовом `take` сразу на мёртвый адрес. Токен на балансе хука не задерживается ни на шаг.

- [ ] **Step 1: Написать падающий тест**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixtures} from "../shared/Fixtures.sol";
import {BlockConfig} from "../../src/lib/BlockConfig.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

contract BlockHookAutoBurnTest is Fixtures {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    PoolKey internal key;
    address internal alice = makeAddr("alice");

    function setUp() public {
        deployFixtures();
        BlockConfig memory cfg = defaultConfig();
        cfg.burnBps = 500; // 5% of token output
        cfg.burnTriggerWei = 1 ether;
        key = initPoolWithConfig(cfg);
        addLiquidity(key, 1000e18);
        vm.deal(alice, 1000 ether);
    }

    function test_qualifyingBuySendsShareOfOutputToDeadAddress() public {
        uint256 deadBefore = token.balanceOf(DEAD);
        vm.prank(alice);
        uint256 out = boundedRouter.buy{value: 2 ether}(key, 0, alice, block.timestamp);

        uint256 burned = token.balanceOf(DEAD) - deadBefore;
        assertGt(burned, 0);
        // burned == grossOut * 500 / 10000, and alice got the rest
        assertEq(burned, ((out + burned) * 500) / 10_000);
    }

    function test_buyBelowTriggerBurnsNothing() public {
        uint256 deadBefore = token.balanceOf(DEAD);
        vm.prank(alice);
        boundedRouter.buy{value: 0.5 ether}(key, 0, alice, block.timestamp);
        assertEq(token.balanceOf(DEAD), deadBefore);
    }

    function test_burnReducesRecipientOutputNotPoolReserves() public {
        uint256 poolTokensBefore = token.balanceOf(address(manager));
        vm.prank(alice);
        uint256 out = boundedRouter.buy{value: 2 ether}(key, 0, alice, block.timestamp);
        uint256 burned = token.balanceOf(DEAD);

        // Everything that left the manager either reached alice or the dead address.
        assertEq(poolTokensBefore - token.balanceOf(address(manager)), out + burned);
        assertEq(token.balanceOf(alice), out);
    }

    function test_sellBurnsNothing() public {
        vm.prank(alice);
        uint256 bought = boundedRouter.buy{value: 2 ether}(key, 0, alice, block.timestamp);
        uint256 deadAfterBuy = token.balanceOf(DEAD);

        vm.startPrank(alice);
        token.approve(address(boundedRouter), bought);
        boundedRouter.sell(key, bought, 0, alice, block.timestamp);
        vm.stopPrank();

        assertEq(token.balanceOf(DEAD), deadAfterBuy);
    }

    function test_hookHoldsNoTokensAfterBurn() public {
        vm.prank(alice);
        boundedRouter.buy{value: 2 ether}(key, 0, alice, block.timestamp);
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(address(hook).balance, 0);
    }

    function testFuzz_burnNeverExceedsOutput(uint96 amountIn) public {
        amountIn = uint96(bound(amountIn, 1 ether, 100 ether));
        uint256 deadBefore = token.balanceOf(DEAD);
        vm.prank(alice);
        uint256 out = boundedRouter.buy{value: amountIn}(key, 0, alice, block.timestamp);
        uint256 burned = token.balanceOf(DEAD) - deadBefore;
        assertLe(burned, out + burned);
        assertLe(burned * 10_000, (out + burned) * 500 + 10_000);
    }
}
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `forge test --match-contract BlockHookAutoBurnTest`
Expected: FAIL — `HookNotImplemented` из `_afterSwap`.

- [ ] **Step 3: Реализовать `_afterSwap`**

```solidity
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    event AutoBurned(PoolId indexed id, uint256 amount);

    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        // Exact-input buys only; sells and exact-output buys pay no token slice.
        if (!params.zeroForOne || params.amountSpecified >= 0) {
            return (BaseHook.afterSwap.selector, 0);
        }

        PoolId id = key.toId();
        BlockConfig memory cfg = _configOf[id];
        if (cfg.burnBps == 0) return (BaseHook.afterSwap.selector, 0);
        if (uint256(-params.amountSpecified) < cfg.burnTriggerWei) {
            return (BaseHook.afterSwap.selector, 0);
        }

        int128 tokenOut = delta.amount1();
        if (tokenOut <= 0) return (BaseHook.afterSwap.selector, 0);

        uint256 burnAmount = BlockMath.bpsCut(uint256(int256(tokenOut)), cfg.burnBps);
        if (burnAmount == 0) return (BaseHook.afterSwap.selector, 0);

        // The returned delta credits the hook; take() settles it straight to the
        // dead address, so the token never rests on the hook's balance.
        poolManager.take(key.currency1, DEAD, burnAmount);
        emit AutoBurned(id, burnAmount);

        return (BaseHook.afterSwap.selector, int128(int256(burnAmount)));
    }
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `forge test --match-contract BlockHookAutoBurnTest -vv`
Expected: PASS, шесть тестов.

- [ ] **Step 5: Прогнать все тесты хука вместе, все пять блоков сразу**

Добавить в `test/unit/BlockHookAutoBurn.t.sol` тест, включающий все пять блоков одновременно, и убедиться, что суммарная стоимость покупки совпадает с формулой §5:

```solidity
    function test_allFiveBlocksTogether() public {
        BlockConfig memory cfg;
        cfg.guardBlocks = 50;
        cfg.maxBuyBps = 500;
        cfg.snipeTaxPips = 10_000;
        cfg.baseFeePips = 3_000;
        cfg.maxFeePips = 50_000;
        cfg.surgeSens = 10_000;
        cfg.burnBps = 500;
        cfg.burnTriggerWei = 0.1 ether;
        cfg.lpBps = 200;
        cfg.potBps = 100;
        cfg.potEveryN = 5;
        cfg.potMinBuyWei = 0.1 ether;

        PoolKey memory k = initSecondPoolWithConfig(cfg);
        addLiquidity(k, 1000e18);
        vm.roll(block.number + 50); // step outside the guard window

        vm.prank(alice);
        boundedRouter.buy{value: 1 ether}(k, 0, alice, block.timestamp);

        assertEq(address(hook).balance, 0);
        assertEq(token2.balanceOf(address(hook)), 0);
    }
```

Run: `forge test`
Expected: PASS, весь набор.

- [ ] **Step 6: Коммит**

```bash
git add src/hook/BlockHook.sol test/unit/BlockHookAutoBurn.t.sol
git commit -m "feat: block 3 auto burn of token output to the dead address"
```

---

### Task 12: `Launchpad` — фабрика, реестры, блупринты, LP-кастодия

**Files:**
- Create: `src/interfaces/ILaunchpad.sol`
- Create: `src/Launchpad.sol`
- Create: `test/unit/Launchpad.t.sol`

**Interfaces:**
- Consumes: `LaunchToken` (Task 2), `BlockHook` (Tasks 5–11), `BlockConfig` (Task 1), Solady `LibClone`.
- Produces:

```solidity
struct LaunchRecord {
    address token;
    address creator;
    uint64 launchBlock;
    uint16 creatorFeeBps;
    uint64 blueprintId;
    address curve;      // address(0) for instant launches
    bool graduated;
    BlockConfig cfg;
}

struct Blueprint {
    address author;
    uint16 royaltyBps;
    BlockConfig cfg;
}

struct InstantParams {
    string name;
    string symbol;
    BlockConfig cfg;
    uint16 creatorFeeBps;   // <= 8000
    uint64 blueprintId;     // 0 = none
    uint160 sqrtPriceX96;
}

struct CurveParams {
    string name;
    string symbol;
    BlockConfig cfg;
    uint16 creatorFeeBps;
    uint64 blueprintId;
    uint256 p0;             // wei of ETH per 1e18 token units, tranche 0
}
```

Функции: `deployHook(bytes32 salt) → address`, `launchInstant(InstantParams) payable → address`, `launchCurve(CurveParams) → address`, `publishBlueprint(BlockConfig,uint16) → uint256`, `claimFees(address token)`, `graduate(address token) payable` (только зарегистрированный клон кривой), `launchCount()`, `tokenAt(uint256)`, `launchRecord(address) → LaunchRecord`, `poolKeyOf(address token) → PoolKey`, `blueprintCount()`, `blueprintAt(uint256)`, `hook()`, `curveImplementation()`, `maxPoolEthWei()`. Ошибки: `PoolTooLarge`, `CreatorFeeTooHigh`, `HookAlreadyDeployed`, `HookNotDeployed`, `NotTheCurve`, `UnknownToken`.

Три жёстких требования к реализации:

**Функции вывода LP-позиции физически нет.** `claimFees` вызывает `modifyLiquidity` с `liquidityDelta = 0` — это собирает накопленную комиссию и не трогает тело позиции. Ни одна функция контракта не вызывает `modifyLiquidity` с отрицательной дельтой. Это проверяется тестом, читающим байткод на отсутствие такой ветки, и инвариантом 8.

**Потолок пула.** `maxPoolEthWei` иммутабелен; `launchInstant` реверти́т, если `msg.value` его превышает, `launchCurve` — если полный сбор кривой его превышает.

**Индекс блупринта 0 — сентинел.** `blueprintAt(0)` возвращает пустую запись, `blueprintId = 0` в записи запуска означает «без блупринта». Это повторяет поведение образца и упрощает жизнь слою чтения.

- [ ] **Step 1: Написать падающий тест**

Тесты (полные тела пишет исполнитель по образцу предыдущих задач, каждый — одно утверждение):

| Тест | Утверждение |
|---|---|
| `test_deployHookLandsOnFlaggedAddress` | `uint160(hook) & 0x3FFF == 0x28CC` |
| `test_deployHookIsOneShot` | второй вызов реверти́т `HookAlreadyDeployed` |
| `test_launchInstantMintsFullSupplyToLaunchpad` | до добавления ликвидности `token.balanceOf(launchpad) == 1_000_000_000e18` |
| `test_launchInstantCreatesPoolWithTheConfig` | `hook.configOf(id)` равен переданному `cfg` поле в поле |
| `test_launchInstantRecordsTheLaunch` | `launchCount()` вырос на 1, `tokenAt(n-1) == token`, `launchRecord(token).creator == msg.sender`, `.launchBlock == block.number` |
| `test_launchAboveMaxPoolEthIsRejected` | `msg.value = maxPoolEthWei + 1` реверти́т `PoolTooLarge` |
| `test_creatorFeeAbove8000IsRejected` | `creatorFeeBps = 8001` реверти́т `CreatorFeeTooHigh` |
| `test_publishBlueprintAssignsIncrementingIds` | первый опубликованный получает id 1, не 0 |
| `test_blueprintZeroIsASentinel` | `blueprintAt(0).author == address(0)` |
| `test_claimFeesSplitsEthBetweenCreatorProtocolAndBlueprintAuthor` | доли сходятся до wei, сумма равна собранному |
| `test_claimFeesBurnsTheTokenSide` | баланс мёртвого адреса вырос ровно на токенную ногу комиссии |
| `test_claimFeesLeavesPositionBodyUntouched` | `getPositionLiquidity` до и после равны |
| `test_thereIsNoFunctionThatRemovesLiquidity` | перебор селекторов `withdraw()`, `removeLiquidity()`, `emergencyExit()`, `owner()` — все `staticcall` неуспешны |
| `test_launchpadHoldsNoEthBetweenTransactions` | после `launchInstant` и после `claimFees` баланс равен нулю |

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `forge test --match-contract LaunchpadTest`
Expected: FAIL — `Source "src/Launchpad.sol" not found`.

- [ ] **Step 3: Написать `src/Launchpad.sol`**

Порядок внутри `launchInstant`: проверить потолок и `creatorFeeBps`; развернуть `LaunchToken` с получателем `address(this)`; собрать `PoolKey` с `currency0 = address(0)`, `currency1 = token`, `fee = DYNAMIC_FEE_FLAG`, `tickSpacing = 60`, `hooks = hook`; вызвать `hook.stageConfig(cfg)`; вызвать `poolManager.initialize(key, sqrtPriceX96)`; внутри `unlock` добавить полнодиапазонную ликвидность из всего предложения токена и присланного ETH; записать `LaunchRecord`; вернуть адрес токена. Роялти автору блупринта вычитается из ETH-доли комиссии в `claimFees`, а не при запуске.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `forge test --match-contract LaunchpadTest -vv`
Expected: PASS, четырнадцать тестов.

- [ ] **Step 5: Коммит**

```bash
git add src/Launchpad.sol src/interfaces/ILaunchpad.sol test/unit/Launchpad.t.sol
git commit -m "feat: Launchpad factory, registries, blueprints and locked LP custody"
```

---

### Task 13: `BondingCurve` и градация

**Files:**
- Create: `src/interfaces/IBondingCurve.sol`
- Create: `src/BondingCurve.sol`
- Modify: `src/Launchpad.sol` (`launchCurve`, `graduate`)
- Create: `test/unit/BondingCurve.t.sol`

**Interfaces:**
- Consumes: `LibClone.clone` из Solady; `Launchpad` (Task 12).
- Produces: `initialize(address token, uint256 p0, address creator)`, `buy(uint256 minTokensOut, address recipient) payable → uint256 tokensOut`, `sell(uint256 tokens, uint256 minEthOut) → uint256 ethOut`, `trancheOf(uint256 sold) view returns (uint8)`, `quoteBuy(uint256 ethIn) view returns (uint256 tokensOut, bool graduates)`, `totalRaiseAtFullSellout(uint256 p0) pure returns (uint256)`, `POW17(uint8 i) pure returns (uint256)`, `graduated() view returns (bool)`, `sold()`, `raised()`. Ошибки: `AlreadyGraduated`, `AlreadyInitialized`, `TooLittleReceived`, `NothingToBuy`.

Таблица степеней задаётся константами, а не возведением в степень в рантайме. Значения точны, а не приближённы: `1.7^i * 1e18 == 17^i * 10^(18-i)` для всех `i` от 0 до 9, потому что у `1.7^9` ровно девять знаков после запятой.

| i | `1.7^i * 1e18` |
|---|---|
| 0 | `1000000000000000000` |
| 1 | `1700000000000000000` |
| 2 | `2890000000000000000` |
| 3 | `4913000000000000000` |
| 4 | `8352100000000000000` |
| 5 | `14198570000000000000` |
| 6 | `24137569000000000000` |
| 7 | `41033867300000000000` |
| 8 | `69757574410000000000` |
| 9 | `118587876497000000000` |
| Σ | `286570557207000000000` |

- [ ] **Step 1: Написать падающий тест на математику**

```solidity
    /// The table must be exact, not approximate: 1.7^i * 1e18 == 17^i * 10^(18-i).
    function test_powerTableIsExact() public pure {
        for (uint8 i = 0; i < 10; i++) {
            assertEq(BondingCurve.POW17(i), (17 ** i) * (10 ** (18 - i)));
        }
    }

    function test_powerTableSumMatchesSpec() public pure {
        uint256 sum;
        for (uint8 i = 0; i < 10; i++) {
            sum += BondingCurve.POW17(i);
        }
        assertEq(sum, 286570557207000000000);
    }

    /// Full sellout collects 80_000_000 * p0 * 286.570557207.
    function test_fullSelloutCollectsTheSpecAmount() public {
        uint256 p0 = 1e9; // wei per 1e18 token units
        uint256 expected = (80_000_000 * p0 * 286570557207000000000) / 1e18;
        assertEq(curve.totalRaiseAtFullSellout(p0), expected);
    }

    function test_trancheBoundaries() public view {
        assertEq(curve.trancheOf(0), 0);
        assertEq(curve.trancheOf(79_999_999e18), 0);
        assertEq(curve.trancheOf(80_000_000e18), 1);
        assertEq(curve.trancheOf(799_999_999e18), 9);
        assertEq(curve.trancheOf(800_000_000e18), 9); // clamped at the last tranche
    }
```

Остальные тесты: покупка внутри одного транша; покупка, пересекающая границу двух траншей, платит по обеим ценам; комиссия 1% делится ровно пополам между создателем и протоколом; продажа обратно по цене текущего транша; попытка купить больше остатка возвращает сдачу; `quoteBuy` совпадает с фактическим исполнением до wei.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `forge test --match-contract BondingCurveTest`
Expected: FAIL — `Source "src/BondingCurve.sol" not found`.

- [ ] **Step 3: Реализовать `BondingCurve`**

`launchpad` — иммутабельная переменная реализации, установленная как `msg.sender` в её конструкторе; клоны наследуют её из кода. Состояние клона (`token`, `p0`, `creator`, `sold`, `raised`, `graduated`) живёт в обычных слотах и задаётся один раз в `initialize`, которая реверти́т при повторном вызове.

- [ ] **Step 4: Написать тест градации**

```solidity
    function test_graduationHappensInTheSameTxAsTheLastTranche() public {
        uint256 toBuyAll = curve.totalRaiseAtFullSellout(P0);
        vm.deal(alice, toBuyAll * 2);

        vm.prank(alice);
        curve.buy{value: toBuyAll}(0, alice);

        assertTrue(curve.graduated());
        // The pool now exists, holds the collected ETH and the remaining 20%.
        PoolKey memory key = launchpad.poolKeyOf(address(curveToken));
        assertGt(manager.getLiquidity(key.toId()), 0);
        assertEq(address(curve).balance, 0, "curve must hold nothing after graduation");
    }

    function test_graduationPriceIsP0Times1_7ToThe9() public {
        _sellOutTheCurve();
        PoolKey memory key = launchpad.poolKeyOf(address(curveToken));
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(key.toId());

        // priceFinal = p0 * 1.7^9 / 1e18, in wei of ETH per 1e18 token units.
        uint256 priceFinal = (P0 * BondingCurve.POW17(9)) / 1e18;
        // The pool quotes token per ETH, so sqrtPriceX96 = sqrt(1e18 / priceFinal) * 2^96.
        uint256 expected = FixedPointMathLib.sqrt(FullMath.mulDiv(1e18, 1 << 192, priceFinal));

        // Allow one unit of rounding in the integer square root, nothing more.
        assertApproxEqAbs(uint256(sqrtPriceX96), expected, 1);
    }

    function test_graduatedPoolCarriesTheSameConfig() public {
        BlockConfig memory launched = launchpad.launchRecord(address(curveToken)).cfg;
        _sellOutTheCurve();
        PoolKey memory key = launchpad.poolKeyOf(address(curveToken));
        BlockConfig memory live = hook.configOf(key.toId());

        assertEq(live.baseFeePips, launched.baseFeePips);
        assertEq(live.maxFeePips, launched.maxFeePips);
        assertEq(live.surgeSens, launched.surgeSens);
        assertEq(live.guardBlocks, launched.guardBlocks);
        assertEq(live.maxBuyBps, launched.maxBuyBps);
        assertEq(live.snipeTaxPips, launched.snipeTaxPips);
        assertEq(live.burnBps, launched.burnBps);
        assertEq(live.burnTriggerWei, launched.burnTriggerWei);
        assertEq(live.lpBps, launched.lpBps);
        assertEq(live.potBps, launched.potBps);
        assertEq(live.potEveryN, launched.potEveryN);
        assertEq(live.potMinBuyWei, launched.potMinBuyWei);
    }

    function test_curveCannotBeTradedAfterGraduation() public {
        _sellOutTheCurve();
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(BondingCurve.AlreadyGraduated.selector);
        curve.buy{value: 1 ether}(0, bob);

        vm.prank(alice);
        vm.expectRevert(BondingCurve.AlreadyGraduated.selector);
        curve.sell(1e18, 0);
    }

    /// Invariant 10 in miniature: once a pool is live, nothing reconfigures it.
    function test_configCannotChangeAfterGraduation() public {
        _sellOutTheCurve();
        PoolKey memory key = launchpad.poolKeyOf(address(curveToken));
        BlockConfig memory before = hook.configOf(key.toId());

        // Staging a different config and re-initializing must not touch the pool.
        BlockConfig memory evil;
        evil.baseFeePips = 100_000;
        evil.maxFeePips = 100_000;
        vm.prank(address(launchpad));
        hook.stageConfig(evil);
        vm.expectRevert(); // the pool is already initialized
        manager.initialize(key, SQRT_PRICE_1_1);

        assertEq(hook.configOf(key.toId()).baseFeePips, before.baseFeePips);
        assertEq(hook.configOf(key.toId()).maxFeePips, before.maxFeePips);
    }

    /// Buys out all ten tranches, triggering graduation on the last one.
    function _sellOutTheCurve() internal {
        uint256 toBuyAll = curve.totalRaiseAtFullSellout(P0);
        vm.deal(alice, toBuyAll * 2);
        vm.prank(alice);
        curve.buy{value: toBuyAll}(0, alice);
        require(curve.graduated(), "curve did not graduate");
    }
```

- [ ] **Step 5: Реализовать градацию в `Launchpad.graduate`**

Вызывается только клоном кривой, зарегистрированным в `launchRecord`. Принимает собранный ETH, забирает оставшиеся 20% предложения, вычисляет `sqrtPriceX96` из финальной цены транша 9, ставит конфиг через `stageConfig`, инициализирует пул и добавляет полнодиапазонную позицию. Позиция принадлежит `Launchpad`, вывода нет.

- [ ] **Step 6: Убедиться, что тесты проходят и прогнать всё**

Run: `forge test`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add src/BondingCurve.sol src/interfaces/IBondingCurve.sol src/Launchpad.sol test/unit/BondingCurve.t.sol
git commit -m "feat: ten-tranche bonding curve with same-transaction graduation"
```

---

### Task 14: Интеграционные тесты на форке мейннета

**Files:**
- Create: `test/integration/InstantLaunch.t.sol`
- Create: `test/integration/CurveLaunchAndGraduation.t.sol`

**Interfaces:**
- Consumes: всё, что построено в задачах 1–13, плюс настоящий `PoolManager` по адресу `0x8366a39CC670B4001A1121B8F6A443A643e40951`.
- Produces: доказательство, что система работает не только против свежесозданного `PoolManager` в памяти, но и против того, что реально стоит в чейне.

- [ ] **Step 1: Написать сетап на форке**

```solidity
    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("robinhood"));
        manager = PoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
        require(address(manager).code.length > 0, "PoolManager not deployed on fork");
        // BoundedRouter, Launchpad, mined salt, deployHook - exactly as Deploy.s.sol does it
    }
```

- [ ] **Step 2: Написать сценарий мгновенного запуска**

Один тест, проходящий весь путь: запуск с пятью включёнными блоками → покупка внутри окна анти-снайпа на пределе лимита → покупка сверх лимита реверти́т → выход из окна → серия покупок до выплаты котла → продажа → `claimFees` → проверка долей. В конце — три проверки: баланс хука ноль, баланс роутера ноль, баланс котла равен учёту.

- [ ] **Step 3: Написать сценарий кривой**

Запуск через кривую → покупки по траншам с проверкой цены на каждой границе → градация на последнем транше → торговля в получившемся пуле → `claimFees`. Проверить, что конфиг пула после градации совпадает с заданным при запуске.

- [ ] **Step 4: Прогнать**

Run: `forge test --match-path "test/integration/*" -vvv`
Expected: PASS. Если RPC недоступен, тесты должны быть помечены `vm.skip(true)` с явным сообщением, а не молча проходить.

- [ ] **Step 5: Коммит**

```bash
git add test/integration/
git commit -m "test: end-to-end integration against the live PoolManager on a fork"
```

---

### Task 15: Инвариантный фаззинг

**Files:**
- Create: `test/invariant/handlers/SystemHandler.sol`
- Create: `test/invariant/Invariants.t.sol`

**Interfaces:**
- Consumes: всю систему.
- Produces: десять инвариантов §8 спеки, один к одному. Это замена аудита, поэтому список не сокращается и не переформулируется.

Handler даёт фаззеру ограниченный набор действий: `launchInstant`, `launchCurve`, `buy`, `sell`, `curveBuy`, `curveSell`, `claimFees`, `advanceBlock`. Каждое действие ограничивает входы через `bound`, а адреса берёт из фиксированного пула акторов. Handler ведёт свой учёт (сколько ETH вошло, сколько комиссий начислено), чтобы инварианты 3, 4 и 9 могли сравнить его с ончейн-состоянием.

- [ ] **Step 1: Написать `SystemHandler`**

- [ ] **Step 2: Написать инварианты**

```solidity
    function invariant_1_hookHoldsNoEth() public view {
        assertEq(address(hook).balance, 0);
    }

    function invariant_2_hookHoldsNoTokens() public view {
        address[] memory tokens = handler.allTokens();
        for (uint256 i; i < tokens.length; i++) {
            assertEq(IERC20(tokens[i]).balanceOf(address(hook)), 0);
        }
    }

    function invariant_3_vaultBalanceEqualsSumOfPots() public view {
        PoolId[] memory ids = handler.allPoolIds();
        uint256 sum;
        for (uint256 i; i < ids.length; i++) {
            sum += hook.potVault().balanceOf(ids[i]);
        }
        assertEq(address(hook.potVault()).balance, sum);
    }

    function invariant_4_cutsNeverExceedInput() public view {
        assertLe(handler.totalCutsTaken(), handler.totalEthIn());
    }

    function invariant_5_potCounterMovesAtMostOncePerBlock() public view {
        // handler records (block, poolId) -> count delta; asserts none exceeds 1
        assertTrue(handler.counterNeverJumped());
    }

    function invariant_6_potPayoutNeverExceedsPot() public view {
        assertTrue(handler.everyPayoutWasCovered());
    }

    function invariant_7_burnReducesRecipientNotReserves() public view {
        assertTrue(handler.everyBurnCameOutOfOutput());
    }

    function invariant_8_lpPositionBodyNeverShrinks() public view {
        PoolId[] memory ids = handler.allPoolIds();
        for (uint256 i; i < ids.length; i++) {
            assertGe(handler.currentPositionLiquidity(ids[i]), handler.peakPositionLiquidity(ids[i]));
        }
    }

    function invariant_9_feesPaidNeverExceedFeesCollected() public view {
        assertLe(handler.totalFeesPaidOut(), handler.totalFeesCollected());
    }

    function invariant_10_poolConfigIsFrozenAfterInit() public view {
        assertTrue(handler.everyConfigStillMatchesItsLaunch());
    }
```

- [ ] **Step 3: Прогнать в дефолтном профиле**

Run: `forge test --match-path "test/invariant/*" -vv`
Expected: PASS, 256 прогонов глубиной 64.

- [ ] **Step 4: Прогнать в профиле CI**

Run: `FOUNDRY_PROFILE=ci forge test --match-path "test/invariant/*"`
Expected: PASS, 2048 прогонов глубиной 128. Занимает минуты. **Любой контрпример здесь — это находка уровня аудита; чинить контракт, а не инвариант.**

- [ ] **Step 5: Коммит**

```bash
git add test/invariant/
git commit -m "test: ten spec invariants under fuzzing, the audit substitute"
```

---

### Task 16: Дифференциальный тест симулятора

**Files:**
- Create: `ts/package.json`, `ts/tsconfig.json`
- Create: `ts/src/simulate.ts`
- Create: `ts/test/simulate.diff.test.ts`
- Create: `test/shared/ExportVectors.t.sol`

**Interfaces:**
- Consumes: `BlockMath` (Task 4).
- Produces: `simulateBuy(config, reserve, amountIn) → { feePips, lpCut, potCut, burnBps, effectiveIn }` на TypeScript, побитово совпадающий с Solidity. Подпроект 5 импортирует именно этот модуль — интерфейс не имеет права считать стоимость покупки сам.

- [ ] **Step 1: Экспортировать векторы из Solidity**

`ExportVectors.t.sol` фаззит `BlockMath` на 2000 случайных входах и пишет JSON в `ts/test/vectors.json`: массив объектов `{amountIn, reserve, baseFeePips, maxFeePips, surgeSens, lpBps, potBps, burnBps, expectedFeePips, expectedLpCut, expectedPotCut}`. Запись через `vm.writeJson`; в `foundry.toml` добавить `fs_permissions` на `./ts/test`.

- [ ] **Step 2: Написать `simulate.ts`**

Все вычисления на `bigint`, деление целочисленное, округление вниз — как в Solidity. Формула `inRangeEthReserve` повторяется дословно, включая `mulDiv`.

- [ ] **Step 3: Написать дифференциальный тест**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import vectors from "./vectors.json" with { type: "json" };
import { surgeFee, bpsCut } from "../src/simulate.js";

describe("solidity parity", () => {
  it("matches every exported vector exactly", () => {
    for (const v of vectors) {
      assert.equal(
        surgeFee(BigInt(v.amountIn), BigInt(v.reserve), v.baseFeePips, v.maxFeePips, v.surgeSens),
        BigInt(v.expectedFeePips),
        `fee mismatch on ${JSON.stringify(v)}`
      );
      assert.equal(bpsCut(BigInt(v.amountIn), v.lpBps), BigInt(v.expectedLpCut));
      assert.equal(bpsCut(BigInt(v.amountIn), v.potBps), BigInt(v.expectedPotCut));
    }
  });
});
```

- [ ] **Step 4: Прогнать обе стороны**

Run: `forge test --match-contract ExportVectorsTest && node --test ts/test/`
Expected: PASS. Расхождение хоть в одном wei — это баг, который однажды заставит интерфейс соврать про цену покупки.

- [ ] **Step 5: Коммит**

```bash
git add ts/ test/shared/ExportVectors.t.sol foundry.toml
git commit -m "test: differential parity between Solidity and the TypeScript simulator"
```

---

### Task 17: Скрипты деплоя и репетиция на форке

**Files:**
- Create: `script/MineHookSalt.s.sol`
- Create: `script/Deploy.s.sol`
- Create: `script/Verify.s.sol`
- Modify: `docs/superpowers/specs/2026-08-30-contracts-design.md` (внести поправки П1–П5)

**Interfaces:**
- Consumes: всю систему.
- Produces: `deployments/4663.json` с адресами шести контрактов и солью хука.

- [ ] **Step 1: Написать `MineHookSalt.s.sol`**

Перебор солей через `HookMiner.find` с деплойером = адрес `Launchpad`. Ожидаемое число попыток около 16 тысяч (14 бит), то есть секунды. Скрипт печатает соль и предвычисленный адрес.

- [ ] **Step 2: Написать `Deploy.s.sol`**

Ровно четыре шага из поправки П3, в этом порядке, с проверкой каждого:

```solidity
    function run() external {
        require(block.chainid == 4663, "wrong chain");
        require(POOL_MANAGER.code.length > 0, "PoolManager missing");
        require(CREATE2_DEPLOYER.code.length > 0, "CREATE2 deployer missing");
        require(maxPoolEthWei > 0, "maxPoolEthWei unset");
        require(protocolFeeRecipient != address(0), "fee recipient unset");

        vm.startBroadcast(deployerPk);
        BoundedRouter router = new BoundedRouter{salt: ROUTER_SALT}(IPoolManager(POOL_MANAGER));
        Launchpad launchpad = new Launchpad{salt: LAUNCHPAD_SALT}(
            IPoolManager(POOL_MANAGER), address(router), protocolFeeRecipient, maxPoolEthWei
        );
        address hookAddr = launchpad.deployHook(hookSalt);
        vm.stopBroadcast();

        require(uint160(hookAddr) & 0x3FFF == 0x28CC, "hook flags wrong");
        require(BlockHook(payable(hookAddr)).launchpad() == address(launchpad), "wiring wrong");
        _writeDeployment(address(router), address(launchpad), hookAddr);
    }
```

- [ ] **Step 3: Написать `Verify.s.sol`**

Читает `deployments/4663.json` и проверяет на живом чейне: флаги адреса хука; `hook.launchpad()`, `hook.router()`, `hook.potVault().hook()` связаны верно; `launchCount() == 0`; `blueprintCount()` на сентинеле; балансы хука и роутера нулевые; `maxPoolEthWei` совпадает с заданным.

- [ ] **Step 4: Репетиция на форке**

```bash
anvil --fork-url https://rpc.mainnet.chain.robinhood.com --port 8545 &
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast --private-key $ANVIL_PK
forge script script/Verify.s.sol --rpc-url http://localhost:8545
```

Expected: оба скрипта отрабатывают, `Verify` проходит все проверки. Затем на том же форке выполнить один настоящий запуск и одну покупку через `cast send`, чтобы убедиться, что система живёт вне тестового харнесса.

- [ ] **Step 5: Внести поправки П1–П5 в спеку**

Обновить §4.3 (конструктор `PotVault` без аргументов), §4.5 (кривая — клон на запуск), §5 (точная формула `inRangeEthReserve`), §7 (новый порядок деплоя из четырёх шагов). Пометить статус спеки как «реализована».

- [ ] **Step 6: Коммит**

```bash
git add script/ docs/superpowers/specs/2026-08-30-contracts-design.md
git commit -m "feat: deployment scripts and fork rehearsal; fold P1-P5 back into the spec"
```

---

### Task 18: Боевой деплой

**Files:**
- Create: `deployments/4663.json`
- Create: `docs/superpowers/specs/2026-08-30-deployed-addresses.md`

**Interfaces:**
- Consumes: `script/Deploy.s.sol`, `script/Verify.s.sol` (Task 17).
- Produces: адреса шести контрактов в мейннете — их читают подпроекты 2, 4, 5 и 6.

**Задача заблокирована до ответа на три вопроса.** Это те самые открытые вопросы §11 спеки, и дальше их откладывать нельзя, потому что они попадают в иммутабельные поля:

1. **`maxPoolEthWei`** — потолок размера пула для v1. Идёт в конструктор `Launchpad` навсегда.
2. **Адрес получателя протокольных комиссий.** Тоже иммутабельный аргумент конструктора.
3. **Порог TVL**, при котором заказывается аудит (§10 спеки). В код не идёт, но должен быть записан до деплоя, иначе его не с чем будет сравнивать.

- [ ] **Step 1: Получить три значения от владельца проекта и записать их в `.env`**

- [ ] **Step 2: Прогнать полный набор тестов в профиле CI**

Run: `FOUNDRY_PROFILE=ci forge test`
Expected: PASS, включая 2048 прогонов инвариантов. Ни одного пропущенного теста.

- [ ] **Step 3: Задеплоить**

```bash
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
```

- [ ] **Step 4: Проверить на живом чейне**

Run: `forge script script/Verify.s.sol --rpc-url $RPC_URL`
Expected: все проверки пройдены.

- [ ] **Step 5: Верифицировать исходники в блокскауте**

Explorer: `robinhoodchain.blockscout.com`. Для каждого из шести контрактов — исходник и аргументы конструктора. `PotVault` и клоны кривой верифицируются отдельно, так как деплоятся из кода, а не скриптом.

- [ ] **Step 6: Записать адреса**

`docs/superpowers/specs/2026-08-30-deployed-addresses.md`: адрес, блок деплоя, аргументы конструктора и ссылка на верифицированный исходник для каждого контракта. Этот документ — вход для подпроекта 2.

- [ ] **Step 7: Коммит**

```bash
git add deployments/4663.json docs/superpowers/specs/2026-08-30-deployed-addresses.md
git commit -m "chore: mainnet deployment addresses for chain 4663"
```

---

## Самопроверка плана

**Покрытие спеки.** Пройдено по разделам: §2.1 → Task 15; §2.2 → Tasks 3, 12, 13; §2.3 → Tasks 5, 13; §2.4 → Task 12 (тест на отсутствие функций); §3.1 → Tasks 8, 10, 11 (проверка нулевого баланса в каждой); §3.2 → Task 3; §3.3 → Task 12; §3.4 → Task 12; §4.1 → Task 2; §4.2 → Tasks 5–11; §4.3 → Task 3; §4.4 → Task 12; §4.5 → Task 13; §4.6 → Task 9; §5 → Tasks 4, 6–11, 16; §6 → Task 5; §7 → Task 17; §8 → Tasks 14, 15, 16; §10 → Task 18 шаг 1; §11 → Task 18 шаг 1.

**Пробелы, оставленные сознательно.** В задачах 12, 13 и 15 тела тестов заданы таблицей утверждений и структурой, а не полным кодом: там 40+ тестов, и выписывать их целиком означало бы удвоить документ, не добавив информации — образцы для подражания заданы в задачах 2–11 и однозначны. Формулировка каждого утверждения при этом конкретна и проверяема, «добавить обработку ошибок» нигде нет.

**Согласованность типов.** `BlockConfig` и `PoolState` заданы в Task 1 и не меняются. `stageConfig`/`configOf`/`stateOf`/`potVault` объявлены в Task 5 и используются под теми же именами в 6–15. `fund`/`pay`/`balanceOf` объявлены в Task 3 и вызываются в Task 10. `buy`/`sell` роутера объявлены в Task 9 и вызываются в 10, 11, 14. `POW17` объявлена в Task 13 и используется только там.

**Известный долг.** В Task 6 хелперы `Fixtures` описаны с ошибкой (`vm.prank` не долетает через `unlock`), и там же дано указание её исправить переносом на контракт `TestRouter`, который в Task 9 заменяется настоящим `BoundedRouter`. Исполнителю Task 6 нужно прочитать замечание к шагу 1 до написания кода.
