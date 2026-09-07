import * as React from "react"

import { Input } from "@/components/ui/input"

function formatDigits(digits: string): string {
  return digits === "" ? "" : Number(digits).toLocaleString("ja-JP")
}

interface NumberInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> {
  /** カンマを含まない数字だけの文字列("" は未入力)。呼び出し側は既存のNumber()変換をそのまま使える */
  value: string
  onChange: (value: string) => void
}

// type="number"はブラウザ仕様上カンマを含む値を受け付けないため、type="text"で代用する。
// フォーカス中はカンマ無しの生の数字をそのまま編集させる(逐一カンマを挿し直すと、
// カンマをbackspaceで消そうとした時などにカーソル位置がずれるため)。フォーカスが
// 外れているときだけカンマ区切りで表示する(よくある金額入力欄と同じ方式)
const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onChange, onFocus, onBlur, onBeforeInput, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false)

    function handleBeforeInput(e: React.InputEvent<HTMLInputElement>) {
      // 数字以外の文字は、DOMに一瞬でも入る前にブロックする(入力後に取り除く方式だと、
      // 結果的に元の値と変わらないためReactが再描画をスキップし、ブラウザ側にだけ
      // 余計な文字やずれたカーソル位置が残ってしまうことがある)
      if (e.data != null && /[^0-9]/.test(e.data)) {
        e.preventDefault()
      }
      onBeforeInput?.(e)
    }

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      // ペースト等、beforeinputを経由しない経路の保険として引き続き除去しておく
      onChange(e.target.value.replace(/[^0-9]/g, ""))
    }

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        value={focused ? value : formatDigits(value)}
        onBeforeInput={handleBeforeInput}
        onChange={handleChange}
        onFocus={(e) => {
          setFocused(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
        {...props}
      />
    )
  }
)
NumberInput.displayName = "NumberInput"

export { NumberInput }
