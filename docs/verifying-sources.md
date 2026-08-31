# Верификация исходников на Blockscout

## Почему вручную

У `robinhoodchain.blockscout.com` перед API стоит Cloudflare в режиме managed
challenge. На любой запрос к `/api` и `/api/v2` возвращается страница «Just a
moment…» вместо JSON — `forge verify-contract` падает на разборе ответа, потому
что ждёт JSON, а получает HTML. Обойти это скриптом нельзя и не нужно: челлендж
проходит обычный браузер, а загрузка одного контракта — минута кликов.

Проверено 2026-08-31 на всех трёх точках входа: `/api`, `/api/v2/addresses/…`,
`/api/v2/smart-contracts/…`.

## Что загружать

Файлы лежат в `verification/` (в git не хранятся, генерируются командой ниже):

| Контракт | Адрес | Файл настроек | Аргументы конструктора |
|---|---|---|---|
| Launchpad | `0x5eE09DF35b6C3503D8fAc6A2863aFd4edBC73a6c` | `Launchpad.standard-input.json` | `Launchpad.args.txt` |
| BlockHook | `0x011a41285314efFE83de63404Aa759a85472E8Cc` | `BlockHook.standard-input.json` | `BlockHook.args.txt` |
| BoundedRouter | `0xD689c128506611e05bf72212eA94B7Df4f9C7C17` | `BoundedRouter.standard-input.json` | `BoundedRouter.args.txt` |
| HookDeployer | `0xeD4856D6CB5883FBC591217482101AE4c5276831` | `HookDeployer.standard-input.json` | `HookDeployer.args.txt` |
| PotVault | `0x02007750325A4311043CFDEb67Fce87eBe10A380` | `PotVault.standard-input.json` | нет |
| BondingCurve | `0xc149D722195b4915aBf2a64cbBe0e54205119D66` | `BondingCurve.standard-input.json` | нет |

Аргументы конструкторов сверены с входными данными реальных транзакций создания:
хвост `input` каждой транзакции совпадает с закодированными аргументами.

## Порядок для одного контракта

1. Открыть `https://robinhoodchain.blockscout.com/address/<адрес>`
2. Вкладка **Contract** → **Verify & Publish**
3. Способ: **Solidity (Standard JSON input)**
4. Компилятор: **v0.8.26+commit.8a97fa7a**
5. Загрузить соответствующий `*.standard-input.json`
6. В поле аргументов конструктора вставить содержимое `*.args.txt` — одной
   строкой, без `0x`. Если файл пустой, поле оставить пустым.
7. Verify & Publish

Оптимизатор, число прогонов (800), версию EVM (`cancun`) и `bytecode_hash: none`
задавать отдельно не нужно: всё это уже внутри standard-json.

## Если не сходится байткод

Скорее всего пересобрано другой версией solc или с другими настройками. Пересобрать
из чистого состояния и перегенерировать файлы:

```bash
forge clean && forge build
```

Затем командой ниже. Настройки в `foundry.toml` менять нельзя — байткод на цепи
собран именно ими.

## Как перегенерировать файлы

```bash
mkdir -p verification
forge verify-contract --show-standard-json-input 0xD689c128506611e05bf72212eA94B7Df4f9C7C17 src/BoundedRouter.sol:BoundedRouter    > verification/BoundedRouter.standard-input.json
forge verify-contract --show-standard-json-input 0xeD4856D6CB5883FBC591217482101AE4c5276831 src/hook/HookDeployer.sol:HookDeployer > verification/HookDeployer.standard-input.json
forge verify-contract --show-standard-json-input 0x5eE09DF35b6C3503D8fAc6A2863aFd4edBC73a6c src/Launchpad.sol:Launchpad            > verification/Launchpad.standard-input.json
forge verify-contract --show-standard-json-input 0x011a41285314efFE83de63404Aa759a85472E8Cc src/hook/BlockHook.sol:BlockHook       > verification/BlockHook.standard-input.json
forge verify-contract --show-standard-json-input 0x02007750325A4311043CFDEb67Fce87eBe10A380 src/PotVault.sol:PotVault              > verification/PotVault.standard-input.json
forge verify-contract --show-standard-json-input 0xc149D722195b4915aBf2a64cbBe0e54205119D66 src/BondingCurve.sol:BondingCurve      > verification/BondingCurve.standard-input.json

PM=0x8366a39CC670B4001A1121B8F6A443A643e40951
ROUTER=0xD689c128506611e05bf72212eA94B7Df4f9C7C17
PAD=0x5eE09DF35b6C3503D8fAc6A2863aFd4edBC73a6c
HD=0xeD4856D6CB5883FBC591217482101AE4c5276831
FEE=0xef048611d7F3077b35Fab260565886186fDa32bA

cast abi-encode "c(address)" $PM | sed 's/^0x//' > verification/BoundedRouter.args.txt
cast abi-encode "c(address)" $PM | sed 's/^0x//' > verification/HookDeployer.args.txt
cast abi-encode "c(address,address,address,uint256,address)" $PM $ROUTER $FEE 100000000000000000000 $HD | sed 's/^0x//' > verification/Launchpad.args.txt
cast abi-encode "c(address,address,address)" $PM $PAD $ROUTER | sed 's/^0x//' > verification/BlockHook.args.txt
```

## Токены запусков

`LaunchToken` создаётся на каждый запуск отдельно, поэтому заранее его
верифицировать нельзя. После первого запуска — тот же порядок, файл
`src/LaunchToken.sol:LaunchToken`, аргументы конструктора берутся из параметров
запуска. Blockscout обычно подхватывает одинаковый байткод автоматически, так что
верифицировать придётся только первый токен.
