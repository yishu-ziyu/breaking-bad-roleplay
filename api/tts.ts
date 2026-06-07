type VercelRequest = {
  method?: string;
  body?: Record<string, unknown>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
};

interface VoiceConfig {
  voice: string;
  style: string;
}

const voiceConfigMap: Record<string, VoiceConfig> = {
  walter: {
    voice: "白桦",
    style: "一位五十多岁的中年男子，声音低沉磁性、冷静克制，咬字极其精准，具有化学老师般的儒雅威压感，语速偏慢，带有冷酷理性的警示色彩。"
  },
  jesse: {
    voice: "苏打",
    style: "一个二十多岁的街头年轻男孩，嗓音沙哑急促，语气焦躁冲动，情绪起伏极大，咬字带着街头的松弛与惊恐摇摆。"
  },
  skyler: {
    voice: "茉莉",
    style: "一位三十多岁的中年女性，声线清透平实但极度紧绷压抑，语速适中，充满对家庭的防护本能与警惕性。"
  },
  saul: {
    voice: "白桦",
    style: "一个圆滑自信的商业律师，语速极快，声音高亢跳跃，充满了连珠炮式的推销口吻，语气夸张极具戏剧感和机敏。"
  },
  mike: {
    voice: "白桦",
    style: "一位老练冷酷的退役老兵，语速缓慢深沉，声音低沉微弱，毫无情绪起伏，字里行间充满了绝对的安全威压与淡定。"
  },
  gus: {
    voice: "白桦",
    style: "一位极度优雅、克制、斯文体面的拉美裔中年绅士，发音通道极度松弛温柔，冷静空洞的音色中透露着高压阶级感。"
  }
};

function mapEmotion(emotion?: string): string {
  if (!emotion) return '';
  const emo = emotion.toLowerCase();
  if (emo.includes('panic') || emo.includes('fear') || emo.includes('anxious') || emo.includes('焦躁')) return '焦躁';
  if (emo.includes('anger') || emo.includes('fury') || emo.includes('愤怒') || emo.includes('生气')) return '愤怒';
  if (emo.includes('cold') || emo.includes('indifferent') || emo.includes('glare') || emo.includes('冷漠')) return '冷漠';
  if (emo.includes('excit') || emo.includes('happy') || emo.includes('激动') || emo.includes('兴奋')) return '激动';
  if (emo.includes('pressure') || emo.includes('tension') || emo.includes('压迫') || emo.includes('紧张')) return '紧张';
  if (emo.includes('control') || emo.includes('restrain') || emo.includes('克制')) return '克制';
  return emotion;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const { characterId, text, emotion, voiceId } = request.body || {};

  if (!text) {
    response.status(400).json({ error: 'text is required.' });
    return;
  }

  const charKey = (characterId as string || 'walter').toLowerCase();
  const config = voiceConfigMap[charKey] || voiceConfigMap.walter;
  // P0-G: MVP 阶段允许调用方覆盖默认 voice
  const resolvedVoice = (voiceId as string) || config.voice;

  const mappedEmo = mapEmotion(emotion as string | undefined);
  const audioText = mappedEmo ? `(${mappedEmo}) ${text}` : (text as string);

  try {
    const apiKey = process.env.MINIMAX_TOKEN_PLAN_KEY;
    if (!apiKey) {
      response.status(400).json({ error: 'MiMo token is not configured.' });
      return;
    }

    const endpoint = 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions';
    const apiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify({
        model: 'mimo-v2.5-tts',
        messages: [
          {
            role: 'user',
            content: config.style
          },
          {
            role: 'assistant',
            content: audioText
          }
        ],
        audio: {
          voice: resolvedVoice,
          format: 'wav'
        }
      })
    });

    if (!apiResponse.ok) {
      const detail = await apiResponse.text();
      throw new Error(detail || `MiMo Speech Synthesis failed with status ${apiResponse.status}.`);
    }

    interface MiMoPayload {
      choices?: Array<{
        message?: {
          audio?: {
            data?: string;
          };
        };
      }>;
    }

    const payload = (await apiResponse.json()) as MiMoPayload;
    const base64Data = payload.choices?.[0]?.message?.audio?.data;

    if (!base64Data) {
      throw new Error('MiMo Speech Synthesis response did not contain base64 audio data.');
    }

    response.status(200).json({ audioData: base64Data });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Speech synthesis execution error.' });
  }
}
