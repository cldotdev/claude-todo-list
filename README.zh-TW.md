# Claude Todo List

[![CI](https://github.com/cldotdev/claude-todo-list/actions/workflows/ci.yml/badge.svg)](https://github.com/cldotdev/claude-todo-list/actions/workflows/ci.yml)

[English](README.md) | 繁體中文

一個 [Claude Code](https://code.claude.com) mod，會持續整理對話中尚未處理的事項，並顯示在 prompt 上方的 band。

對話一長，還沒做的決定、答應過的後續工作和沒回答的問題就會被埋在很前面，很容易漏掉。這個 mod 會隨著對話進行把它們收集起來，在處理完之前一直留在眼前。

![示範](assets/demo.gif)

## 運作方式

- 每次主迴圈的 turn 以回答結束後，mod 會把這個 turn 送給 Sonnet (用的是 `sonnet` alias，實際模型跟著安裝的 Claude Code 版本走)，問它這個 turn 解決了清單上的哪些事項、又多出哪些新的事項。Subagent 的 turn 不算在內。
- 待辦事項指的是有人說要延後的工作、agent 答應要做的後續工作或檢查，以及還沒有結論的問題或決定。正在執行的這一步、同一個 turn 內就完成的事，以及已經列在 OpenSpec `tasks.md` 裡的任務，都不會列入。
- 每個事項有一行標題和一段簡短說明，語言跟 agent 回答時用的語言相同。
- 清單按 session 分開保存，恢復 session 時會一起還原。清單超過 `cleanupPeriodDays` 設定的天數沒更新就會被刪除，這個設定也決定 Claude Code 保留 transcript 的天數，預設 30 天。所有 session 保存的清單加起來超過 mod 儲存空間 4 MiB 上限的 80% 時，會從最久沒更新的清單開始刪除，直到降回 80% 以下，但不會刪除目前 session 的清單。清單存不下來時，每個 session 會跳一次 toast 提醒。`/clear` 會清空清單和垃圾桶。
- 每個離開清單的事項都會進垃圾桶，記下標題、說明、是誰移除的 (你或模型) 和移除時間。每種來源各保留最新的 99 筆。你刪除的事項不會再被加回來；模型移除的事項除非對話重新提起，否則也不會再被加回來。
- 有些事項是被後來的 turn 蓋過才失效，沒有哪一個 turn 會明確移除它，所以 mod 還會回頭檢查最近的 turn：累計 8 個有回答的 turn，或清單有 6 個以上事項且累計 3 個 turn 時執行。檢查只會移除已經不再待辦的事項，不會新增。被移除的事項可以用 `/todos restore` 放回清單。

每個有回答的 turn 會多一次 Sonnet 呼叫；每次檢查也是一次 Sonnet 呼叫，最多每 3 個 turn 一次。`/todos refresh` 會 fork 主對話，所以是用主模型帶著完整 context 執行。它會根據整段對話逐項檢查清單上的事項：移除已經不再待辦的、補上漏掉的，也可能改寫保留事項的說明，但保留的事項標題不變。剛 resume 之後還沒有可以 fork 的對話，這時改用 transcript 重建清單，仍然是用主模型，但沒有 prompt cache，所以花費較高。transcript 只取最新的 200,000 個字元，每則工具結果最多保留 2,000 個字元。

## 需求

支援 mod 的 Claude Code (>= 2.1.299)。

## 安裝

從這個 repo 的 marketplace 安裝：

```bash
claude plugin marketplace add cldotdev/claude-todo-list
claude plugin install todo-list@claude-todo-list
```

## 使用方式

### `/todos` 指令

| 指令 | 作用 |
| --- | --- |
| `/todos` | 列出待辦事項和說明 |
| `/todos pane` | 在 pane 裡開啟清單，詳見 [Pane](#pane) 一節。prompt 輸入框是空的時，即使 pane 已經開著，也會把按鍵交給 pane。`/todos pane <文字>` 仍會把 `pane <文字>` 當成 prompt 送出 |
| `/todos refresh` | 根據整段對話逐項檢查：移除不再待辦的事項、補上漏掉的、更新說明 |
| `/todos clear` | 刪除所有事項，這些事項會記為你刪除的，放進垃圾桶 |
| `/todos reset` | 清空清單和垃圾桶，所有「不再加回來」的限制也一併解除 |
| `/todos trash` | 由新到舊列出被移除的事項、說明和移除者 |
| `/todos restore <編號>` | 把垃圾桶裡的事項放回清單，編號照 `/todos trash` 顯示的為準，寫法和 `delete` 的編號相同。只要有一個編號超出垃圾桶範圍，整次還原就會取消 |
| `/todos purge <編號>` | 把垃圾桶裡的事項永久刪除，編號照 `/todos trash` 顯示的為準。永久刪除你刪過的事項後，模型就可以再把它加回來 |
| `/todos delete <編號>` | 依編號刪除事項，例如 `2`、`1-3` 或 `1,4 6`。只要有一個編號超出清單範圍，整次刪除就會取消 |
| `/todos <prompt>` | 把所有事項加上編號、以引用的形式放在 prompt 前面一起送出，prompt 裡就能寫「做 1 和 2，跳過 3」這類指示 |

### Band

清單有事項且 pane 沒有開著時，prompt 上方的 band 會顯示加上編號的清單。band 以視窗顯示清單，編號仍是整份清單的編號，視窗下方會用暗色的 `<n> more` 標出後面還有幾個事項。視窗放得下多少事項，取決於 Claude Code 分給 band 的列數，最多 10 個，所以 prompt 輸入框裡的草稿變長時，視窗會縮小，不會讓 band 捲動。band 取得焦點時，說明列會變長，可能多佔一列，擠得很小的視窗因此可能少一個事項。離開 band 後，視窗會回到最前面。

| 按鍵 | 動作 |
| --- | --- |
| `Ctrl+X Tab` | 把焦點移到 band |
| `j`/`k`、`Tab`/`Shift+Tab` | 移到下一個或上一個事項 |
| `s` | 選取或取消選取焦點所在的事項 |
| `a` | 選取所有事項，所有事項都已選取時則清除選取 |
| `n`/`p` | 把視窗往下或往上翻最多一個視窗的事項數，焦點會留在視窗裡的同一列。整份清單放得進視窗、視窗已無法再移動，或正在顯示事項說明時，不會有動作 |
| `v` | 把已選取的事項貼到 prompt 輸入框，沒有選取時貼焦點所在的事項，每項都附上它在 band 裡的編號 |
| `o`/`Enter` | 顯示焦點所在事項的說明，或回到清單 |
| `t` | 切換到 pane，band 會隱藏 |
| `b` | 用 `/btw` 詢問焦點所在的事項，Claude 正在工作時會等目前這一輪結束才回答 |
| `d` | 刪除焦點所在的事項，要再按一次 `d` 確認，按 `Esc` 取消 |
| `Esc` | 回到 prompt，band 正在顯示事項說明時會切回清單 |

### Pane

pane 把事項列在獨立的 pane 裡。全螢幕模式下，終端機寬度達 110 欄時，Claude Code 會把它固定在 transcript 旁邊，從上到下佔滿，所以長 prompt 不會把它擠小。每個標題都完整顯示，需要幾列就換成幾列，band 則會把沒有焦點的標題截成一列。它的視窗以列數計算，放得下多少事項就顯示多少，沒有 10 個的上限，視窗下方用暗色的 `<n> more` 標出後面還有幾個事項。清單是空的時，pane 會顯示 `No open items.`

- **開啟**：在 band 上按 `t`，或執行 `/todos pane`。除此之外，pane 只在預設檢視是 `pane` 時，於 session 開始或恢復 session 時自己開啟，band 被擠小時不會。pane 開著時不會畫出 band，清單只在一處顯示。prompt 輸入框是空的、沒有其他東西占用按鍵時執行 `/todos pane`，pane 會取得按鍵，pane 已經開著時也一樣。按 `t` 時，pane 要求按鍵的當下按鍵仍在 band 手上，所以要再按一次 `Ctrl+X Tab` 才會移到 pane
- **預設檢視**：`default_view` 設定可選 `band` (預設) 或 `pane`，在 `/config` 裡顯示為 `todo-list.default_view`，並存在你的設定中。它在 session 開始或恢復 session 時生效，清單是空的也一樣，而且這時開啟的 pane 不會取得按鍵，打字仍會進到 prompt 輸入框；在 `/config` 裡的變更要到下一次 session 開始才生效，`t` 則會立刻切換。mod 的 hot reload 和 `/clear` 不會再套用一次。pane 只有在 Claude Code 排得下時才會開啟：沒有被要求開啟的 pane 需要 144 欄寬的終端機 (手動開過之後降為 110 欄)，比這窄時就維持 band
- **關閉**：在 pane 上按 `t`、按 `Ctrl+X X` 或點 pane 的關閉標記都會關閉 pane 並讓 band 回來，pane 的焦點、選取和展開的說明也會一併清除。`Esc` 只把按鍵還給 prompt 輸入框，pane 仍開著。`/clear` 會清掉 pane 的狀態，但 pane 仍開著
- **按鍵**：和 band 相同，有 `j`/`k`、`Tab`/`Shift+Tab`、`s`、`a`、`n`/`p`、`v`、`o`/`Enter`、`b` 和 `d`，只有兩處不同：`o`/`Enter` 會把焦點所在事項的說明展開在它的那一列下方，一次只展開一個事項，其餘清單仍然顯示。移動焦點時展開的說明會跟著移動，再按一次 `o` 就收合；pane 的 `t` 是切回 band，沒有 band 那個開啟 pane 的 `t`
- **狀態**：pane 有自己的焦點、展開的說明、選取、待確認的刪除和視窗位置，和 band 的互不影響。在 prompt 輸入框打字、送出 prompt、按 `Esc` 都不會重設它們，band 離開時也不會動到它們。`v` 貼上成功後會清除 pane 的選取。pane 沒有按鍵時不會畫出焦點圓點，但仍保留焦點，說明列會提示用 `Ctrl+X Tab` 回來。事項因為 pane 自己的刪除以外的原因離開清單時，pane 的焦點會移到現在位在同一位置的事項

## 開發

| 路徑 | 內容 |
| --- | --- |
| `hooks/register.tsx` | 事件 hook、`/todos` 指令、band 和 pane |
| `hooks/list.ts` | 給模型的 prompt、回覆解析，以及 band 和 pane 視窗的計算 |
| `hooks/store.ts` | 儲存用的 key，以及讓儲存空間不超過上限的計算 |
| `types/index.d.ts` | mod 的 state 型別定義 |
| `tests/` | 由 `claude plugin test` 執行的測試 |

```bash
claude plugin validate .
claude plugin test .
```

要試用本機的修改，啟動 Claude Code 時載入 clone，只對這個 session 有效：

```bash
claude --plugin-dir /path/to/claude-todo-list
```

在這個 session 裡，clone 會取代已安裝的 `todo-list@claude-todo-list`，不需要先停用或解除安裝。

## 授權

[MIT](LICENSE)
