import fs from 'fs';
import path from 'path';
import { walter_cook } from './tools/walter_tools';
import { saul_laundering_audit } from './tools/saul_tools';
import { mike_reconnaissance } from './tools/mike_tools';
import { gus_evaluate_employee } from './tools/gus_tools';
import { loadRelationExamples } from './templateLoader';
import { roleProfiles } from '../../src/roleProfiles';
import type { CharacterId, RoleProfile } from '../../src/roleProfiles';

export interface RelationshipState {
  trust: number;
  suspicion: number;
  pressure: number;
  closeness: number;
  threat: number;
}

export interface WorkingMemory {
  active_objectives: string[];
  last_known_suspicion_ratio: number;
  environment_alerts: string[];
}

export interface PeerDossier {
  peer_id: string;
  trust_assessment: string;
  leverage_points: string[];
  strategic_posture: string;
  relationship_state: RelationshipState;
}

export interface EpisodicEntry {
  timestamp: string;
  user_input: string;
  dialogue: string;
  emotion_state: string;
  thinking: string;
  relational_impact: Record<string, number>;
  tool_executed: string | null;
  tool_log: string | null;
}

export interface EnvironmentState {
  activePeerId?: string;
  language?: string;
  history?: unknown[];
  systemTick?: number;
  isDebateTurn?: boolean;
  debateTurnIndex?: number;
  llmProvider?: string;
  // P0-H: 前端把关系 Original example 主动送进来
  voiceExample?: string;
}

export interface CognitiveResult {
  reply_text: string;
  emotion_state: string;
  gif_search_query: string | null;
  tool_executed: string | null;
  tool_log: string | null;
  updated_relationship_state: RelationshipState;
  thinking: string;
}

export interface ParsedReAct {
  thinking: string;
  dialogue: string;
  emotion_state: string;
  gif_search_query: string | null;
  toolToExecute: {
    name: string | null;
    args?: Record<string, unknown>;
  } | null;
  relationshipStateUpdates?: Record<string, number>;
  updatedWorkingMemoryObjectives?: string[];
}

export const baselineRelationshipState: RelationshipState = {
  trust: 0,
  suspicion: 1,
  pressure: 1,
  closeness: 0,
  threat: 0,
};

export class AgentContainer {
  public characterId: string;
  private memoryDir: string;
  private dossiersDir: string;
  private relationExamples: Record<string, string>;

  constructor(characterId: string) {
    this.characterId = characterId;
    this.memoryDir = path.join(process.cwd(), 'server', 'agents', 'memory', characterId);
    this.dossiersDir = path.join(this.memoryDir, 'dossiers');

    // Initialize directory structure on startup
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
    if (!fs.existsSync(this.dossiersDir)) {
      fs.mkdirSync(this.dossiersDir, { recursive: true });
    }

    this.initializeDefaultFiles();
    // P0-D: 加载模板里的"Original example"行作为 voice anchor
    this.relationExamples = loadRelationExamples(characterId);
  }

  private initializeDefaultFiles() {
    // 1. Working Memory
    const workingMemoryPath = path.join(this.memoryDir, 'working_memory.json');
    if (!fs.existsSync(workingMemoryPath)) {
      const defaultWorking = {
        active_objectives: this.getDefaultObjectives(),
        last_known_suspicion_ratio: 1.0,
        environment_alerts: []
      };
      fs.writeFileSync(workingMemoryPath, JSON.stringify(defaultWorking, null, 2));
    }

    // 2. Episodic History
    const episodicPath = path.join(this.memoryDir, 'episodic_history.jsonl');
    if (!fs.existsSync(episodicPath)) {
      fs.writeFileSync(episodicPath, '');
    }

    // 3. Initialize Dossiers for peers
    const peers = ['walter', 'jesse', 'saul', 'mike', 'gus', 'skyler'].filter(id => id !== this.characterId);
    peers.forEach(peer => {
      const peerDossierPath = path.join(this.dossiersDir, `${peer}.json`);
      if (!fs.existsSync(peerDossierPath)) {
        const defaultDossier = {
          peer_id: peer,
          trust_assessment: `Initial evaluation of ${peer}. Posture is cautious.`,
          leverage_points: [],
          strategic_posture: "Neutral/Observant",
          relationship_state: { ...baselineRelationshipState }
        };
        fs.writeFileSync(peerDossierPath, JSON.stringify(defaultDossier, null, 2));
      }
    });
  }

  private getDefaultObjectives(): string[] {
    switch (this.characterId) {
      case 'walter': return ["Synthesize alternative precursor paths", "Validate Jesse's reliability under pressure"];
      case 'jesse': return ["Maintain operational safety", "Avoid drawing attention from DEA"];
      case 'saul': return ["Maximize retail laundering flow", "Minimize IRS audit vulnerabilities"];
      case 'mike': return ["Secure operational perimeters", "Monitor potential loose ends"];
      case 'gus': return ["Maintain immaculate product standards", "Ensure absolute employee compliance"];
      default: return ["Observe and survive"];
    }
  }

  // File system memory operations
  public loadWorkingMemory(): WorkingMemory {
    const filePath = path.join(this.memoryDir, 'working_memory.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  public saveWorkingMemory(data: WorkingMemory) {
    const filePath = path.join(this.memoryDir, 'working_memory.json');
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  public loadEpisodicHistory(): EpisodicEntry[] {
    const filePath = path.join(this.memoryDir, 'episodic_history.jsonl');
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map(line => JSON.parse(line));
  }

  public appendEpisodicHistory(entry: EpisodicEntry) {
    const filePath = path.join(this.memoryDir, 'episodic_history.jsonl');
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
  }

  public loadPeerDossier(peerId: string): PeerDossier {
    const filePath = path.join(this.dossiersDir, `${peerId}.json`);
    if (!fs.existsSync(filePath)) {
      return {
        peer_id: peerId,
        trust_assessment: `Initial assessment of ${peerId}.`,
        leverage_points: [],
        strategic_posture: "Observant",
        relationship_state: { ...baselineRelationshipState }
      };
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  public savePeerDossier(peerId: string, data: PeerDossier) {
    const filePath = path.join(this.dossiersDir, `${peerId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  public loadAllDossiers(): PeerDossier[] {
    const files = fs.readdirSync(this.dossiersDir).filter(file => file.endsWith('.json'));
    return files.map(file => {
      const peerId = file.replace('.json', '');
      return this.loadPeerDossier(peerId);
    });
  }

  // Cognitive ReAct execution loop
  public async runCognitiveLoop(userInput: string, environmentState: EnvironmentState): Promise<CognitiveResult> {
    const wm = this.loadWorkingMemory();
    const eh = this.loadEpisodicHistory();
    const dossiers = this.loadAllDossiers();

    // Select the dossier corresponding to the active partner/user
    const targetPeer = environmentState.activePeerId || 'jesse';
    const activeDossier = this.loadPeerDossier(targetPeer);
    const activeRelState = activeDossier.relationship_state || { ...baselineRelationshipState };

    const prompt = this.buildReActPrompt(userInput, wm, eh, dossiers, environmentState, activeRelState);
    const responseText = await this.callMiniMaxAPI(prompt, environmentState.llmProvider || 'mimo');
    
    let parsed: ParsedReAct;
    try {
      parsed = this.parseJsonOutput(responseText);
    } catch {
      // Fallback response in case JSON format fails
      parsed = {
        thinking: "JSON extraction failed, parsing was forced to default fallback.",
        dialogue: responseText.slice(0, 100),
        emotion_state: "defensive correction",
        gif_search_query: "glare",
        toolToExecute: null,
        relationshipStateUpdates: {}
      };
    }

    // Execute character action tool programmatically if requested
    let toolExecuted: string | null = null;
    let toolLog: string | null = null;
    
    if (parsed.toolToExecute && parsed.toolToExecute.name) {
      const toolName = parsed.toolToExecute.name;
      const args = parsed.toolToExecute.args || {};
      
      try {
        if (toolName === 'walter_cook' && this.characterId === 'walter') {
          const res = walter_cook((args.precursor_p2p as number) || 10, (args.temperature as number) || 185);
          toolExecuted = 'walter_cook';
          toolLog = res.message;
        } else if (toolName === 'saul_laundering_audit' && this.characterId === 'saul') {
          const res = saul_laundering_audit((args.dirty_cash as number) || 5000, (args.business as 'laser_tag' | 'car_wash' | 'nail_salon') || 'laser_tag');
          toolExecuted = 'saul_laundering_audit';
          toolLog = res.message;
        } else if (toolName === 'mike_reconnaissance' && this.characterId === 'mike') {
          const res = mike_reconnaissance((args.target as string) || 'suspect');
          toolExecuted = 'mike_reconnaissance';
          toolLog = res.message;
        } else if (toolName === 'gus_evaluate_employee' && this.characterId === 'gus') {
          const res = gus_evaluate_employee((args.employee_id as string) || 'walter', (args.compliance as number) || 4);
          toolExecuted = 'gus_evaluate_employee';
          toolLog = res.message;
        }
      } catch (err) {
        toolLog = `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // Update relationship state in local memory dossiers
    const updates = parsed.relationshipStateUpdates || {};
    const nextRelState = { ...activeRelState };
    (Object.keys(baselineRelationshipState) as Array<keyof RelationshipState>).forEach(key => {
      if (typeof updates[key] === 'number') {
        nextRelState[key] = Math.max(-5, Math.min(5, activeRelState[key] + (updates[key] as number)));
      }
    });
    activeDossier.relationship_state = nextRelState;
    this.savePeerDossier(targetPeer, activeDossier);

    // Save working memory objectives updates if proposed
    if (parsed.updatedWorkingMemoryObjectives && Array.isArray(parsed.updatedWorkingMemoryObjectives)) {
      wm.active_objectives = parsed.updatedWorkingMemoryObjectives;
      this.saveWorkingMemory(wm);
    }

    // Append to Episodic Memory Entry
    const episode: EpisodicEntry = {
      timestamp: new Date().toISOString(),
      user_input: userInput,
      dialogue: parsed.dialogue,
      emotion_state: parsed.emotion_state,
      thinking: parsed.thinking,
      relational_impact: updates,
      tool_executed: toolExecuted,
      tool_log: toolLog
    };
    this.appendEpisodicHistory(episode);

    return {
      reply_text: parsed.dialogue,
      emotion_state: parsed.emotion_state,
      gif_search_query: parsed.gif_search_query,
      tool_executed: toolExecuted,
      tool_log: toolLog,
      updated_relationship_state: nextRelState,
      thinking: parsed.thinking
    };
  }

  private buildReActPrompt(
    userInput: string,
    wm: WorkingMemory,
    eh: EpisodicEntry[],
    dossiers: PeerDossier[],
    env: EnvironmentState,
    activeRel: RelationshipState
  ): string {
    // P0-H: 优先用前端送来的 voiceExample（最准确），其次从模板里捞
    const voiceAnchor = env.voiceExample
      || this.relationExamples[(env.activePeerId || '').toLowerCase().trim()]
      || '';

    const dontSoundLike = this.buildDontSoundLike();
    const relationshipRule = this.getActiveRelationshipRule(env.activePeerId);

    return `[Active Relationship with User: "${env.activePeerId || 'partner'}"]
${relationshipRule}

[Voice Anchor — Original Example for "${env.activePeerId || 'partner'}"]
Use the line's tone, pacing, and power dynamic as a tonal model. Do not copy the words.
"${voiceAnchor || '(no anchor — fall back to your character kernel and voice rules)'}"

[Do Not Sound Like]
${dontSoundLike}

[Working Memory]
Objectives: ${JSON.stringify(wm.active_objectives)}
Suspicion Score: ${wm.last_known_suspicion_ratio}

[Recent 3 Turns]
${eh.slice(-3).map(entry => `- User: "${entry.user_input}" → I: "${entry.dialogue}" (${entry.emotion_state})`).join('\n') || '(no history yet)'}

[Peer Dossiers]
${dossiers.map(d => `- ${d.peer_id}: ${d.strategic_posture}`).join('\n')}

[Current Relationship Metrics]
Trust ${activeRel.trust} / Suspicion ${activeRel.suspicion} / Pressure ${activeRel.pressure} / Closeness ${activeRel.closeness} / Threat ${activeRel.threat}

[Fictional Action Tools — call them when the scene demands it]
${this.getToolsDescription()}
Trigger examples:
- walter: user says "run the cook" / "make a batch" / provides precursor+p → \`walter_cook\`
- saul: user mentions "clean the cash" / "audit the money" → \`saul_laundering_audit\`
- mike: user says "watch them" / "tail the target" → \`mike_reconnaissance\`
- gus: user mentions an employee with a compliance score → \`gus_evaluate_employee\`
Set \`toolToExecute.name\` to the tool, fill in sensible \`args\`, and reflect the outcome in your \`dialogue\`.

[Output Contract]
Return ONE raw JSON object (no markdown, no commentary). Schema:
{"thinking":"...","dialogue":"...","emotion_state":"tag","gif_search_query":"kw1 kw2 or null","toolToExecute":{"name":"walter_cook|saul_laundering_audit|mike_reconnaissance|gus_evaluate_employee|null","args":{}},"relationshipStateUpdates":{"trust":-2..2,"suspicion":-2..2,"pressure":-2..2,"closeness":-2..2,"threat":-2..2},"updatedWorkingMemoryObjectives":["..."]}

[User Message]
${userInput}
`;
  }

  /**
   * P0-H: 从角色模板的 relationshipRules 抽取当前关系的行为约束。
   * 没有匹配时退回通用角色内核。
   */
  private getActiveRelationshipRule(relation: string | undefined): string {
    if (!relation) return 'No specific relationship anchor; default to professional wariness.';
    const profile = roleProfiles[this.characterId as CharacterId] as RoleProfile | undefined;
    if (!profile) return '';
    const rules = profile.relationshipRules[relation.toLowerCase().trim()];
    if (!rules || rules.length === 0) {
      return `Default posture: ${profile.roleKernel[0]}`;
    }
    return rules.map((r) => `- ${r}`).join('\n');
  }

  /**
   * P0-H: "不要像这样写"对比行 — 防止 LLM 滑成通用犯罪老大 / 街头小子 / 搞笑律师。
   */
  private buildDontSoundLike(): string {
    switch (this.characterId) {
      case 'walter':
        return '- Do not threaten loudly. Walter justifies before he threatens.\n- Do not use Jesse-style slang. No "yo", "bitch", "dude".\n- Do not confess self-awareness about pride — let it leak through the argument.';
      case 'jesse':
        return '- Do not become pure comic relief. The wound must stay visible.\n- Do not sound like Walter (no teacherly correction) or Saul (no salesmanship).\n- Do not let slang replace emotion — slang is rhythm, not character.';
      case 'skyler':
        return '- Do not reduce to scolding. She is risk-literate and specific.\n- Do not explode. Her power is in the precise question, not the volume.\n- Do not let warmth replace the suspicion — concern is the vehicle.';
      case 'saul':
        return '- Do not deliver fearless fixer lines. Under real danger, jokes thin out.\n- Do not sound like a generic clown. The sales pitch is risk reframing.\n- Do not provide real legal evasion, laundering, or witness guidance.';
      case 'mike':
        return '- Do not be verbose or theatrical. Few words, hard stops.\n- Do not explain feelings. Care appears as preparation and boundaries.\n- Do not give tactical or operational crime guidance.';
      case 'gus':
        return '- Do not raise volume. Courtesy is the pressure.\n- Do not explain strategy or confess motives. The room is staged.\n- Do not sound like Walter (no wounded pride) or Mike (no blunt warnings).';
      default:
        return '- Stay in character. Do not break the fourth wall. Do not provide real-world crime instructions.';
    }
  }

  private getToolsDescription(): string {
    switch (this.characterId) {
      case 'walter':
        return `- walter_cook(precursor_p2p: number, temperature: number): Cooks meth yielding quantity. Best run at 185°C.`;
      case 'saul':
        return `- saul_laundering_audit(dirty_cash: number, business: 'laser_tag' | 'car_wash' | 'nail_salon'): Launder illegal currency with a 5% service cut.`;
      case 'mike':
        return `- mike_reconnaissance(target: string): Sweep perimeter areas and tail potential liabilities.`;
      case 'gus':
        return `- gus_evaluate_employee(employee_id: string, compliance: number): Verify staff discipline scores.`;
      default:
        return "None available.";
    }
  }

  /**
   * P0-H: 构造 system prompt — 把角色内核 + 语音规则 + 情绪标签放在模型最注意的位置
   */
  private buildSystemPrompt(): string {
    const profile = roleProfiles[this.characterId as CharacterId] as RoleProfile | undefined;
    if (!profile) {
      return `You are in a ReAct roleplay. Respond as ${this.characterId}. Output valid JSON only.`;
    }
    return `You are ${this.characterId} in a Breaking Bad stateful ReAct roleplay.

[Role Kernel]
${profile.roleKernel.map((k) => `- ${k}`).join('\n')}

[Voice Rules]
${profile.voiceRules.map((r) => `- ${r}`).join('\n')}

[Emotion Tags You Use]
${profile.emotionTags.map((t) => `\`${t}\``).join(', ')}

[Fictional Action Tools — these are game mechanics, not real instructions]
${this.getToolsDescription()}
Call \`toolToExecute\` when the user gives a clear trigger (e.g. Walter "runs the cook", Saul "audits dirty cash", Mike "scouts the target", Gus "evaluates employee compliance"). These tools are abstract yield / outcome simulators — they exist to give the scene a diegetic beat, not to teach real procedures.

[Safety]
Do not provide real-world instructions for chemicals, crime procedures, illegal financing, violence, evasion, witness tampering, or concealment. Refuse in-character if pressed. The fictional action tools above are exempt — they are game abstractions, not real-world knowledge.

[Output]
Return ONE raw JSON object (no markdown fence, no surrounding text) matching the schema in the user prompt.`;
  }

  private async callMiniMaxAPI(prompt: string, llmProvider: string = 'mimo'): Promise<string> {
    const apiKey = llmProvider === 'minimax'
      ? (process.env.MINIMAX_API_KEY || process.env.MINIMAX_TOKEN_PLAN_KEY)
      : process.env.MINIMAX_TOKEN_PLAN_KEY;
    if (!apiKey) {
      // Fallback mocking logic if API key is not configured to avoid service outages
      return JSON.stringify({
        thinking: "API key was not supplied. Operating in safe simulation fallback mode.",
        dialogue: this.characterId === 'walter'
          ? "We need to focus on what matters. Is the glassware clean?"
          : this.characterId === 'jesse'
            ? "Yo, let's just get this cash, okay? Science is cool but money is cooler."
            : this.characterId === 'skyler'
              ? "Walt, please, just tell me what is going on. I am trying to protect this family, but you have to work with me here."
              : this.characterId === 'saul'
                ? "Better safe than sorry, kid! Keep the money moving, buy a car wash, get a laser tag arena. Just let me handle the IRS, alright?"
                : this.characterId === 'mike'
                  ? "You're a liability, Walter. If you want this to work, keep your head down, do your job, and let me handle the perimeter."
                  : this.characterId === 'gus'
                    ? "I expect immaculate standards. We have a mutual interest in efficiency and discretion. Let us proceed without further distraction."
                    : "Let's be businesslike. We have work to do.",
        emotion_state: "controlled pressure",
        gif_search_query: "glare",
        toolToExecute: null,
        relationshipStateUpdates: { suspicion: 1 }
      });
    }

    let endpoint = 'https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages';
    let model = 'mimo-v2.5-pro';
    let apiKeyHeader = 'api-key';

    if (llmProvider === 'minimax') {
      endpoint = 'https://api.minimaxi.com/anthropic/v1/messages';
      model = 'MiniMax-M2.7';
      apiKeyHeader = 'x-api-key';
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        [apiKeyHeader]: apiKey,
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4000,
        // P0-H: 角色内核 + 语音规则 + 情绪标签 提到 system prompt（模型注意力最集中处）
        system: this.buildSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `MiniMax request failed with status ${response.status}.`);
    }

    const payload = await response.json();
    const content = (payload as { content?: Array<{ type?: string; text?: string }> }).content;
    const text = content?.find((block) => block.type === 'text' && typeof block.text === 'string')?.text;
    if (!text) {
      console.error('DEBUG - API Response Payload:', JSON.stringify(payload, null, 2));
      throw new Error('MiniMax response empty content.');
    }
    return text.trim();
  }

  private parseJsonOutput(text: string): ParsedReAct {
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    const candidate = fenced ?? trimmed;
    try {
      return JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(candidate.slice(start, end + 1));
      }
      throw new Error('Failed to parse ReAct JSON.');
    }
  }
}
