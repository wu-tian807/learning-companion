import type { LearningBrief } from './shared';

const textFields = [
  { key: 'goal', label: '学习目标', hint: '想学什么、最终希望做到什么', empty: '尚未确认学习目标' },
  { key: 'currentLevel', label: '当前基础', hint: '已有知识、经验和起点', empty: '尚未确认当前基础' },
  { key: 'difficulties', label: '困难', hint: '已知障碍、担心的问题', empty: '尚未确认；可以明确告知暂无或不确定' },
  { key: 'constraints', label: '约束', hint: '时间、设备、资源等限制', empty: '尚未确认；可以明确告知无特殊限制' },
  { key: 'preferences', label: '学习偏好', hint: '讲解方式、练习形式、学习顺序', empty: '尚未确认；可以明确告知无特殊偏好' },
  { key: 'scope', label: '学习范围', hint: '重点、深度以及不包含的内容', empty: '尚未确认学习范围' },
] as const;

/** Full field details belong to the outline view, outside the chat sidebar. */
export function LearningBriefDetails({ brief }: {
  readonly brief: LearningBrief;
}) {
  const cardClass = 'min-w-0 rounded-lg border border-white/[0.07] bg-black/10 p-3';
  const titleClass = 'flex items-center justify-between gap-2 text-xs font-medium text-slate-200';
  const badgeClass = 'shrink-0 text-[10px] font-normal text-slate-500';
  const hintClass = 'mt-1 text-[10px] leading-4 text-slate-500';
  const contentClass = 'mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-slate-300';

  return (
    <dl className="mt-3 grid gap-2" style={{
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 18rem), 1fr))',
    }}>
      {textFields.map(({ key, label, hint, empty }) => (
        <div key={key} className={cardClass}>
          <dt className={titleClass}>{label}<span className={badgeClass}>必填</span></dt>
          <dd>
            <p className={hintClass}>{hint}</p>
            <p className={contentClass}>{brief[key].trim() ? brief[key] : empty}</p>
          </dd>
        </div>
      ))}
      <div className={`${cardClass} col-span-full`}>
        <dt className={titleClass}>路线草案<span className={badgeClass}>至少一项</span></dt>
        <dd>
          <p className={hintClass}>AI 根据已确认需求整理的大章顺序，可在对话中调整</p>
          {brief.roadmap.length > 0 ? (
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-xs leading-5 text-slate-300">
              {brief.roadmap.map((item) => (
                <li key={item.id} className="break-words pl-1">
                  <p className="whitespace-pre-wrap font-medium">{item.title}</p>
                  {item.goal?.trim() && <p className="whitespace-pre-wrap text-slate-400">学习成果：{item.goal}</p>}
                  {item.notes?.trim() && <p className="whitespace-pre-wrap text-slate-400">说明：{item.notes}</p>}
                </li>
              ))}
            </ol>
          ) : <p className={contentClass}>尚未整理路线草案</p>}
        </dd>
      </div>
      <div className={cardClass}>
        <dt className={titleClass}>待确认问题<span className={badgeClass}>完成前需确认完毕</span></dt>
        <dd>
          <p className={hintClass}>仍影响学习规划的关键缺口</p>
          {brief.openQuestions.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-300">
              {brief.openQuestions.map((question, index) => <li key={index} className="whitespace-pre-wrap break-words">{question}</li>)}
            </ul>
          ) : <p className={contentClass}>暂无待确认问题</p>}
        </dd>
      </div>
      <div className={cardClass}>
        <dt className={titleClass}>额外补充<span className={badgeClass}>可选</span></dt>
        <dd>
          <p className={hintClass}>上述字段涵盖不到的信息，不影响必填项完成</p>
          <p className={contentClass}>{brief.detailed?.trim() ? brief.detailed : '暂无，可在对话中继续补充'}</p>
        </dd>
      </div>
    </dl>
  );
}
