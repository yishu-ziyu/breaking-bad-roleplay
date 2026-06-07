/**
 * Template Loader (P0-D)
 *
 * 从 materials/breaking-bad/{CHAR}_TEMPLATE.md 解析出每个关系的
 * "Original example" 行，用于注入到 ReAct prompt 作为 voice anchor。
 *
 * 解析规则：
 *   ### {Relation Name}
 *   ... rules ...
 *   Original example:
 *
 *   ```text
 *   {example line}
 *   ```
 *
 * 容错：文件不存在 / 没有 Original example 段 / 解析失败时返回空 map，
 * AgentContainer 会自动跳过注入（不报错）。
 */

import fs from 'fs';
import path from 'path';

export function loadRelationExamples(characterId: string): Record<string, string> {
  const templatePath = path.join(
    process.cwd(),
    'materials',
    'breaking-bad',
    `${characterId.toUpperCase()}_TEMPLATE.md`,
  );
  if (!fs.existsSync(templatePath)) return {};
  try {
    const template = fs.readFileSync(templatePath, 'utf-8');
    return parseTemplateExamples(template);
  } catch (err) {
    console.warn(`[templateLoader] Failed to read ${templatePath}:`, err);
    return {};
  }
}

function parseTemplateExamples(template: string): Record<string, string> {
  const examples: Record<string, string> = {};
  // 匹配：### {Relation}\n ... Original example: \n ```任意语言\n(内容)\n```
  const sectionRegex =
    /###\s+([^\n]+)[\s\S]*?Original example:\s*\n+\s*```[a-z]*\n([\s\S]*?)\n```/g;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(template)) !== null) {
    const relation = match[1].trim().toLowerCase();
    const example = match[2].trim();
    if (relation && example) {
      examples[relation] = example;
    }
  }
  return examples;
}
