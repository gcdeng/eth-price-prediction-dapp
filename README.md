# ETH Price Prediction Dapp

## Intro

這是一個猜 ETH 價格漲跌的 dapp 小遊戲，猜對的玩家可以依照投注比例贏取獎金。

遊戲規則：

- 只有 admin 可以開局讓大家來猜 ETH 漲跌
- admin 開局後玩家可以開始投入自己的 ETH 到合約中並下注猜 ETH 漲跌
  - 下注時間(liveIntervalSeconds)可由 admin 在開局時設定
- 下注結束後，需要等待一段鎖倉時間才會關局
  - 鎖倉時間(lockIntervalSeconds)可由 admin 在開局時設定，最少要兩小時，確保 chainlink 有更新價格
- 關局後猜對的玩家可以向合約 claim 贏到的 ETH，依照投入比例計算獎金
  > 公式：`(個人投入金額/總贏家投入金額) * 這一回合的總下注金額`
- 如果回合結束時價錢沒變（沒漲沒跌），則沒有贏家，由莊家獲得全部投注金(treasury)

## Get Started

Install modules

```sh
yarn
```

Testing

use mock oracle contract for testing

```sh
yarn test
```

## Future improvement

1. 鎖倉期間將全部投注金拿去 compound 放貸賺利息，猜對漲跌的玩家也可以平分利息做為獎金。
2. 不只能猜 ETH，開局時也可以設定其他 token 作為標的。
3. 加入前端串接 web3.js + metamask 方便使用者下注。
4. 加入後端 cronjob 自動化打合約 lock/end round。

## Reference

- <https://docs.pancakeswap.finance/products/prediction>
- <https://docs.chain.link/data-feeds/price-feeds/addresses>
- <https://blog.chain.link/fetch-current-crypto-price-data-solidity/>
- <https://data.chain.link/ethereum/mainnet/crypto-usd/eth-usd>
- <https://mochajs.org/>
- <https://hardhat.org/hardhat-runner/docs/guides/test-contracts>
