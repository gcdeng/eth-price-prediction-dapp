# ETH Price Prediction Dapp

## Intro

這是一個猜 ETH 價格漲跌的 dapp 小遊戲，猜對的玩家可以依照投注比例贏取獎金。

遊戲規則：

- 只有 admin 可以開局讓大家來猜 ETH 漲跌
- 開局後玩家可以投入自己的 ETH 到合約後下注猜漲跌，下注時間可以由 admin 在開局時設定
- 下注結束後，等待一段時間才會關局，等待時間可由 admin 在開局時設定
- 關局後猜對的玩家可以 claim 贏到的 ETH，依照投入比例計算獎金，公式：`(個人投入金額/總贏家投入金額) * 這一回合的總下注金額`
- 如果回合結束時價錢沒變（沒漲沒跌），則沒有贏家，由莊家獲得全部投注金

## Get Started

Try running some of the following tasks:

```shell
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat run scripts/deploy.js
```
