type I18nStrings = Record<string, string | Record<string, string>>;

const BUILTIN_STRINGS: Record<string, I18nStrings> = {
  en: {
    init: {
      title: 'AgentOS v1.0.0',
      subtitle: 'Your AI agents, organized.',
      lang_prompt: 'What language should docs and artifacts be written in?',
      runner_prompt: 'Which AI runner will you use?',
      profile_prompt: 'How do you like to work?',
      modules_prompt: 'Which modules would you like to install?',
      state_prompt: 'Is this a new or existing project?',
      git_prompt: 'How should we handle Git commits?',
      success: 'All set! Your project is configured in .agentos/',
      runner_synced: 'Runner instructions are ready',
      ready: 'You\'re good to go! Open your AI runner and start building.',
    },
    profiles: {
      solo: 'Solo — move fast, fewer checkpoints',
      team: 'Team — balanced process with reviews',
      full: 'Full — thorough process, all gates enabled',
    },
    git: {
      auto: 'Auto-commit when artifacts change',
      manual: 'I\'ll commit manually',
      none: 'Skip Git integration',
    },
    doctor: {
      checking: 'Checking your setup...',
      ok: 'Everything looks good!',
      fix: 'Found some issues to fix:',
    },
  },
  pt: {
    init: {
      title: 'AgentOS v1.0.0',
      subtitle: 'Seus agentes IA, organizados.',
      lang_prompt: 'Em qual idioma os docs e artefatos devem ser escritos?',
      runner_prompt: 'Qual AI runner voc\u00ea vai usar?',
      profile_prompt: 'Como voc\u00ea prefere trabalhar?',
      modules_prompt: 'Quais m\u00f3dulos deseja instalar?',
      state_prompt: '\u00c9 um projeto novo ou existente?',
      git_prompt: 'Como devemos lidar com os commits?',
      success: 'Tudo certo! Seu projeto est\u00e1 configurado em .agentos/',
      runner_synced: 'Instru\u00e7\u00f5es do runner prontas',
      ready: 'Pronto pra come\u00e7ar! Abra seu AI runner e m\u00e3os \u00e0 obra.',
    },
    profiles: {
      solo: 'Solo \u2014 r\u00e1pido, menos checkpoints',
      team: 'Time \u2014 processo equilibrado com revis\u00f5es',
      full: 'Completo \u2014 processo detalhado, todos os gates',
    },
    git: {
      auto: 'Commitar automaticamente quando artefatos mudarem',
      manual: 'Vou commitar manualmente',
      none: 'Pular integra\u00e7\u00e3o com Git',
    },
    doctor: {
      checking: 'Verificando sua instala\u00e7\u00e3o...',
      ok: 'Tudo certo por aqui!',
      fix: 'Encontrei alguns problemas:',
    },
  },
  es: {
    init: {
      title: 'AgentOS v1.0.0',
      subtitle: 'Tus agentes IA, organizados.',
      lang_prompt: '\u00bfEn qu\u00e9 idioma deben escribirse los docs y artefactos?',
      runner_prompt: '\u00bfQu\u00e9 AI runner vas a usar?',
      profile_prompt: '\u00bfC\u00f3mo prefieres trabajar?',
      modules_prompt: '\u00bfQu\u00e9 m\u00f3dulos te gustar\u00eda instalar?',
      state_prompt: '\u00bfEs un proyecto nuevo o existente?',
      git_prompt: '\u00bfC\u00f3mo quieres manejar los commits?',
      success: '\u00a1Listo! Tu proyecto est\u00e1 configurado en .agentos/',
      runner_synced: 'Instrucciones del runner listas',
      ready: '\u00a1Todo listo! Abre tu AI runner y a construir.',
    },
    profiles: {
      solo: 'Solo \u2014 r\u00e1pido, menos checkpoints',
      team: 'Equipo \u2014 proceso equilibrado con revisiones',
      full: 'Completo \u2014 proceso detallado, todos los gates',
    },
    git: {
      auto: 'Auto-commit cuando cambien los artefactos',
      manual: 'Voy a hacer commits manualmente',
      none: 'Sin integraci\u00f3n con Git',
    },
    doctor: {
      checking: 'Verificando tu instalaci\u00f3n...',
      ok: '\u00a1Todo se ve bien!',
      fix: 'Encontr\u00e9 algunos problemas:',
    },
  },
};

// Map display names and codes to locale codes
const LANG_MAP: Record<string, string> = {
  English: 'en',
  'Portugues': 'pt',
  'Portuguese (Brazil)': 'pt',
  'Espanol': 'es',
  'Spanish': 'es',
  en: 'en',
  pt: 'pt',
  'pt-BR': 'pt',
  es: 'es',
};

export class I18n {
  private locale: string;
  private strings: I18nStrings;

  constructor(lang: string = 'English') {
    this.locale = LANG_MAP[lang] || 'en';
    this.strings = BUILTIN_STRINGS[this.locale] || BUILTIN_STRINGS.en;
  }

  t(key: string): string {
    const parts = key.split('.');
    let current: I18nStrings | string = this.strings;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = (current as Record<string, I18nStrings | string>)[part];
      } else {
        return key; // Fallback to key itself
      }
    }
    return typeof current === 'string' ? current : key;
  }

  getLocale(): string {
    return this.locale;
  }
}
