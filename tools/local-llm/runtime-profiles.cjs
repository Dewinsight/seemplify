const RUNTIME_PROFILE_DEFINITIONS = Object.freeze({
  'experience-management': Object.freeze({
    stateKey: 'experienceManagement',
    activityPrefix: 'experience.',
    defaultEngine: 'codex',
    defaultModel: 'gpt-5.6-terra'
  })
});

const RUNTIME_PROFILE_IDS = Object.freeze(Object.keys(RUNTIME_PROFILE_DEFINITIONS));

function defaultApplicationDefaults() {
  return Object.fromEntries(RUNTIME_PROFILE_IDS.map((id) => {
    const definition = RUNTIME_PROFILE_DEFINITIONS[id];
    return [definition.stateKey, {
      engine: definition.defaultEngine,
      model: definition.defaultModel
    }];
  }));
}

function mergeApplicationDefaults(saved = {}) {
  const defaults = defaultApplicationDefaults();
  return Object.fromEntries(RUNTIME_PROFILE_IDS.map((id) => {
    const { stateKey } = RUNTIME_PROFILE_DEFINITIONS[id];
    const savedProfile = saved?.[stateKey];
    return [stateKey, {
      ...defaults[stateKey],
      ...(savedProfile && typeof savedProfile === 'object' ? savedProfile : {})
    }];
  }));
}

function isRuntimeProfile(value) {
  return Object.hasOwn(RUNTIME_PROFILE_DEFINITIONS, String(value || '').trim().toLowerCase());
}

function runtimeProfileForActivity(activity) {
  const normalized = String(activity || '').trim().toLowerCase();
  return RUNTIME_PROFILE_IDS.find((id) => (
    normalized.startsWith(RUNTIME_PROFILE_DEFINITIONS[id].activityPrefix)
  )) || '';
}

function runtimeProfileFromStatusInput(input = {}) {
  const explicit = String(input.runtimeProfile || '').trim().toLowerCase();
  if (explicit) return explicit;
  const source = String(input.source || '').trim().toLowerCase();
  return isRuntimeProfile(source) ? source : '';
}

module.exports = {
  RUNTIME_PROFILE_DEFINITIONS,
  RUNTIME_PROFILE_IDS,
  defaultApplicationDefaults,
  isRuntimeProfile,
  mergeApplicationDefaults,
  runtimeProfileForActivity,
  runtimeProfileFromStatusInput
};
