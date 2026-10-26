import React, { useId, useState } from "react";
import { MessageSquare } from "lucide-react";

export function UserInputForm({
  questions,
  isBlocking = true,
  disabled = false,
  onSubmit,
}) {
  const prefix = useId();
  const [answers, setAnswers] = useState(() =>
    Object.fromEntries(
      questions.map((question) => [
        question.id,
        {
          choice: !isBlocking && question.options?.length ? 0 : null,
          text: "",
        },
      ]),
    ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const result = Object.fromEntries(
    questions.map((question) => {
      const answer = answers[question.id];
      const text =
        typeof answer.choice === "number"
          ? question.options[answer.choice].label
          : answer.text;
      return [
        question.id,
        {
          answers: [
            typeof answer.choice === "number" || question.isSecret
              ? text
              : text.trim(),
          ],
        },
      ];
    }),
  );
  const incomplete =
    !questions.length ||
    Object.values(result).some((answer) => !answer.answers[0].trim());
  const locked = disabled || submitting || submitted;
  function update(id, patch) {
    setAnswers((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
    setError("");
  }
  async function submit(event) {
    event.preventDefault();
    if (locked || incomplete) return;
    setSubmitting(true);
    setError("");
    try {
      if ((await onSubmit(result)) === false)
        setError("回答发送失败，请检查连接后重试。");
      else setSubmitted(true);
    } catch (error) {
      setError(error.message || "回答发送失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form
      className="request-card user-input-card"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (
          event.key !== "Enter" ||
          event.nativeEvent.isComposing ||
          event.keyCode === 229
        )
          return;
        if (event.ctrlKey) submit(event);
        else if (event.target.tagName === "INPUT") event.preventDefault();
      }}
    >
      <div className="request-title">
        <MessageSquare size={18} />
        需要你的回答
      </div>
      <p className="request-hint">
        {isBlocking
          ? "提交回答后，Codex 将继续处理。"
          : "Codex 会继续处理，你可以随时补充回答。"}
      </p>
      {questions.map((question) => {
        const answer = answers[question.id];
        const hasOptions = !!question.options?.length;
        const allowOther = question.isOther !== false || !hasOptions;
        const inputId = `${prefix}-${question.id}-text`;
        const textInput = {
          id: inputId,
          className: "free-answer",
          "aria-label": question.question,
          placeholder: question.isSecret ? "输入私密回答" : "输入你的回答",
          value: answer.text,
          onChange: (event) =>
            update(question.id, { text: event.target.value }),
        };
        return (
          <fieldset className="question" key={question.id} disabled={locked}>
            <legend>{question.header || "问题"}</legend>
            <p>{question.question}</p>
            {question.options?.map((option, index) => (
              <label
                className={
                  "answer-option " + (answer.choice === index ? "selected" : "")
                }
                key={index}
              >
                <input
                  type="radio"
                  name={`${prefix}-${question.id}`}
                  checked={answer.choice === index}
                  onChange={() => update(question.id, { choice: index })}
                />
                <span>
                  <b>{option.label}</b>
                  {option.description && <small>{option.description}</small>}
                </span>
              </label>
            ))}
            {hasOptions && allowOther && (
              <label
                className={
                  "answer-option " +
                  (answer.choice === "other" ? "selected" : "")
                }
              >
                <input
                  type="radio"
                  name={`${prefix}-${question.id}`}
                  checked={answer.choice === "other"}
                  onChange={() => update(question.id, { choice: "other" })}
                />
                <span>其他回答</span>
              </label>
            )}
            {allowOther && (!hasOptions || answer.choice === "other") && (
              <>
                <label className="answer-label" htmlFor={inputId}>
                  {question.isSecret ? "私密回答" : "你的回答"}
                </label>
                {question.isSecret ? (
                  <input {...textInput} type="password" autoComplete="off" />
                ) : (
                  <textarea {...textInput} rows={3} />
                )}
              </>
            )}
          </fieldset>
        );
      })}
      {error && <p role="alert">{error}</p>}
      <div className="request-actions">
        <small className="request-hint" role="status">
          {submitted
            ? "回答已发送"
            : disabled
              ? "当前暂时无法提交，请稍后重试"
              : "Ctrl+Enter 提交 · Enter 换行"}
        </small>
        <button
          type="submit"
          className="primary"
          disabled={locked || incomplete}
        >
          {submitting ? "正在提交…" : submitted ? "已提交回答" : "提交回答"}
        </button>
      </div>
    </form>
  );
}
