const OpenAI = require('openai');
const axios = require('axios');
const { buildScoringRubricText } = require('./mosaicPolicyService');

function readEnvAny(keys, fallback = '') {
    for (const key of keys) {
        const value = process.env[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return fallback;
}

function toNumberOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveOpenAIConfig() {
    const profile = readEnvAny(['AZURE_OPENAI_PROFILE', 'OPENAI_PROFILE'], 'default').toLowerCase();
    const preferKimi = profile.includes('kimi');

    const apiKeyKeys = preferKimi
        ? ['Azure_openai_kimi2.5_key', 'AZURE_OPENAI_API_KEY']
        : ['AZURE_OPENAI_API_KEY', 'Azure_openai_kimi2.5_key'];
    const endpointKeys = preferKimi
        ? ['Azure_openai_kimi2.5_endpoint', 'AZURE_OPENAI_ENDPOINT']
        : ['AZURE_OPENAI_ENDPOINT', 'Azure_openai_kimi2.5_endpoint'];
    const deploymentKeys = preferKimi
        ? ['Azure_openai_kimi2.5_deployment_name', 'AZURE_OPENAI_DEPLOYMENT_NAME']
        : ['AZURE_OPENAI_DEPLOYMENT_NAME', 'Azure_openai_kimi2.5_deployment_name'];
    const versionKeys = preferKimi
        ? ['Azure_openai_kimi2.5_version', 'AZURE_OPENAI_API_VERSION']
        : ['AZURE_OPENAI_API_VERSION', 'Azure_openai_kimi2.5_version'];
    const targetUriKeys = preferKimi
        ? ['Azure_openai_kimi2.5_target_uri', 'AZURE_OPENAI_TARGET_URI']
        : ['AZURE_OPENAI_TARGET_URI', 'Azure_openai_kimi2.5_target_uri'];
    const responsesUrl = readEnvAny(['AZURE_OPENAI_RESPONSES_URL', 'AZURE_OPENAI_PROJECT_RESPONSES_URL']);
    const responsesApiKey = readEnvAny(['AZURE_OPENAI_RESPONSES_API_KEY', 'AZURE_OPENAI_API_KEY']);
    const responsesModel = readEnvAny(['AZURE_OPENAI_RESPONSES_MODEL', 'AZURE_OPENAI_MODEL', 'AZURE_OPENAI_DEPLOYMENT_NAME']);

    const apiKey = readEnvAny(apiKeyKeys);
    let endpoint = readEnvAny(endpointKeys);
    let deployment = readEnvAny(deploymentKeys);
    let apiVersion = readEnvAny(versionKeys);
    const targetUri = readEnvAny(targetUriKeys);

    if (targetUri) {
        try {
            const parsed = new URL(targetUri);
            if (!endpoint) endpoint = parsed.origin;
            if (!apiVersion) apiVersion = parsed.searchParams.get('api-version') || apiVersion;

            const deploymentMatch = parsed.pathname.match(/\/openai\/deployments\/([^/]+)/i);
            if (!deployment && deploymentMatch?.[1]) {
                deployment = decodeURIComponent(deploymentMatch[1]);
            }
        } catch (_) {
            // Ignore invalid target URI and continue with explicit env vars.
        }
    }

    const cleanEndpoint = endpoint.replace(/\/+$/, '');
    const baseURL = cleanEndpoint && deployment
        ? `${cleanEndpoint}/openai/deployments/${deployment}`
        : '';

    const temperatures = {
        rules: toNumberOr(readEnvAny(['AI_TEMPERATURE_RULE_EVAL']), 0),
        priority: toNumberOr(readEnvAny(['AI_TEMPERATURE_PRIORITY']), 0),
        summary: toNumberOr(readEnvAny(['AI_TEMPERATURE_SUMMARY']), 0)
    };

    return {
        profile,
        apiKey,
        endpoint: cleanEndpoint,
        deployment,
        apiVersion,
        baseURL,
        responsesUrl,
        responsesApiKey,
        responsesModel,
        provider: responsesUrl ? 'responses' : 'chat_completions',
        temperatures
    };
}

function loadScoringRubric() {
    try {
        return buildScoringRubricText();
    } catch (error) {
        console.warn('Could not load scoring rubric from Mosaic policy:', error.message);
        return null;
    }
}

function inferCategory(rule) {
    const explicit = String(rule.category || '').trim().toUpperCase();
    if (explicit) return explicit;
    const hint = `${rule.name || ''} ${rule.description || ''} ${rule.criteria || ''}`;
    return /(escalat|tier\s*3|trigger)/i.test(hint) ? 'ESCALATION' : 'GENERAL';
}

function isTriggerCategory(category) {
    const normalized = String(category || '').trim().toUpperCase();
    return ['ESCALATION', 'PENALTY', 'CAP', 'BOOST'].includes(normalized);
}

function stripCodeBlocks(value) {
    return String(value || '')
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
}

function parseJsonPayload(value) {
    const cleaned = stripCodeBlocks(value);

    try {
        return JSON.parse(cleaned);
    } catch (_) {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            const slice = cleaned.slice(firstBrace, lastBrace + 1);
            return JSON.parse(slice);
        }
        throw new Error('Model response is not valid JSON.');
    }
}

function buildRulePrompts(rules) {
    return rules.map(rule => {
        const mandatoryTag = rule.isMandatory ? '[MANDATORY]' : '[OPTIONAL]';
        const category = inferCategory(rule);
        const modeTag = isTriggerCategory(category) ? '[TRIGGER_STYLE]' : '[REQUIREMENT_STYLE]';
        const ruleId = (rule._id || '').toString();
        const criteria = rule.criteria || rule.description || '';
        const effects = Array.isArray(rule.effects) ? rule.effects : [];
        const effectText = effects.length > 0
            ? ` | Effects: ${effects.map(effect => {
                const type = String(effect?.type || '').toUpperCase();
                const params = effect?.params || {};
                if (type === 'SET_TIER') return `SET_TIER(${params.tier || '?'})`;
                if (type === 'SET_FLAG') return `SET_FLAG(${params.key || '?'})`;
                return type || 'UNKNOWN_EFFECT';
            }).join(', ')}`
            : '';
        return `- Rule ID: ${ruleId} | Category: ${category} | ${mandatoryTag} ${modeTag}${effectText} | ${rule.name}: ${criteria}`;
    }).join('\n');
}

class OpenAIService {
    constructor() {
        this.config = resolveOpenAIConfig();
        if (this.config.provider === 'responses') {
            if (!this.config.responsesUrl || !this.config.responsesApiKey || !this.config.responsesModel) {
                throw new Error('Azure OpenAI Responses config missing. Set AZURE_OPENAI_RESPONSES_URL, AZURE_OPENAI_RESPONSES_MODEL, and an API key.');
            }
            this.client = null;
            return;
        }

        if (!this.config.apiKey || !this.config.baseURL || !this.config.apiVersion || !this.config.deployment) {
            throw new Error(
                'Azure OpenAI config missing. Set AZURE_OPENAI_* vars or Azure_openai_kimi2.5_* vars.'
            );
        }
        this.client = new OpenAI({
            apiKey: this.config.apiKey,
            baseURL: this.config.baseURL,
            defaultQuery: { 'api-version': this.config.apiVersion },
            defaultHeaders: { 'api-key': this.config.apiKey }
        });
    }

    async createCompletion(messages, options = {}) {
        if (this.config.provider === 'responses') {
            return this.createResponsesCompletion(messages, options);
        }
        return this.createChatCompletion(messages, options);
    }

    async createChatCompletion(messages, options = {}) {
        const {
            temperature = 0,
            parseJson = true
        } = options;
        const requestPayload = {
            messages,
            model: this.config.deployment,
            temperature
        };

        // Prefer strict JSON mode for structured responses when supported.
        if (parseJson) {
            requestPayload.response_format = { type: 'json_object' };
        }

        let completion;
        try {
            completion = await this.client.chat.completions.create(requestPayload);
        } catch (error) {
            const message = String(error?.message || '').toLowerCase();
            const unsupportedJsonMode =
                parseJson &&
                (message.includes('response_format') ||
                    message.includes('json_object') ||
                    message.includes('unsupported'));

            if (!unsupportedJsonMode) throw error;

            const fallbackPayload = {
                messages,
                model: this.config.deployment,
                temperature
            };
            completion = await this.client.chat.completions.create(fallbackPayload);
        }

        const content = completion?.choices?.[0]?.message?.content || '';
        return parseJson ? parseJsonPayload(content) : content;
    }

    extractResponsesText(responseData) {
        if (typeof responseData?.output_text === 'string') return responseData.output_text;
        const output = Array.isArray(responseData?.output) ? responseData.output : [];
        const chunks = [];

        output.forEach((item) => {
            if (typeof item?.content === 'string') {
                chunks.push(item.content);
                return;
            }
            if (Array.isArray(item?.content)) {
                item.content.forEach((contentPart) => {
                    if (typeof contentPart?.text === 'string') chunks.push(contentPart.text);
                    else if (typeof contentPart?.text?.value === 'string') chunks.push(contentPart.text.value);
                    else if (typeof contentPart?.value === 'string') chunks.push(contentPart.value);
                });
            }
        });

        return chunks.join('\n').trim();
    }

    async createResponsesCompletion(messages, options = {}) {
        const {
            temperature = 0,
            parseJson = true
        } = options;
        const payload = {
            model: this.config.responsesModel,
            input: messages,
            temperature
        };

        if (parseJson) {
            payload.text = { format: { type: 'json_object' } };
        }

        let response = await axios.post(this.config.responsesUrl, payload, {
            timeout: 120000,
            headers: {
                'Content-Type': 'application/json',
                'api-key': this.config.responsesApiKey,
                Authorization: `Bearer ${this.config.responsesApiKey}`
            },
            validateStatus: () => true
        });

        if ((response.status < 200 || response.status >= 300) && parseJson) {
            const retryPayload = { ...payload };
            delete retryPayload.text;
            response = await axios.post(this.config.responsesUrl, retryPayload, {
                timeout: 120000,
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': this.config.responsesApiKey,
                    Authorization: `Bearer ${this.config.responsesApiKey}`
                },
                validateStatus: () => true
            });
        }

        if (response.status < 200 || response.status >= 300) {
            const message = typeof response.data === 'string'
                ? response.data
                : JSON.stringify(response.data || {});
            throw new Error(`Responses API request failed ${response.status}: ${message}`);
        }

        const content = this.extractResponsesText(response.data);
        return parseJson ? parseJsonPayload(content) : content;
    }

    async analyzeProject(projectContext, rules) {
        try {
            const rulePrompts = buildRulePrompts(rules);

            const rubric = loadScoringRubric();
            const scoringSection = rubric ? `
            === TASK 2: PRIORITY SCORING DIMENSIONS (use rubric definitions) ===
            Score each parameter 1-5 (higher = more favorable). Use these definitions.
            IMPORTANT: Backend applies organization-specific weights after this step.

            ${rubric.lines}
            ` : `
            === TASK 2: PRIORITY SCORING DIMENSIONS ===
            Score each parameter 1-5:
            Strategic Alignment (25%), Regulatory Risk (25%), Business Impact (20%),
            Implementation Complexity (15%), Time-to-Value (10%), Resource Requirements (5%).
            Backend applies dynamic organization weights and tier ranges.
            `;

            const prompt = `
            You are a strict AI Initiative Approver for Sterling Financial Holdings Group.
            Analyze the initiative against all rules and calculate priority scoring.

            === APPROVAL RULES ===
            ${rulePrompts}

            === INITIATIVE CONTEXT ===
            ${projectContext}

            === TASK 1: RULE ANALYSIS ===
            Evaluate EVERY listed rule exactly once.
            Return one rulesAnalysis entry for each Rule ID.
            You must not skip any rule.
            If evidence is weak or uncertain, still return Pass or Fail with a short reason.

            Rule status meaning:
            - For GATE and GENERAL rules: Pass means requirement satisfied. Fail means not satisfied.
            - For ESCALATION, PENALTY, CAP, and BOOST rules:
              Pass means trigger condition is NOT present.
              Fail means trigger condition IS present.

            Rules marked [MANDATORY] are critical, but trigger-style categories
            (ESCALATION/PENALTY/CAP/BOOST) should still use trigger semantics above.
            ${scoringSection}

            Return strict JSON only:
            {
                "overallStatus": "Approved" | "Rejected",
                "rulesAnalysis": [
                    {
                        "ruleId": "exact Rule ID from input",
                        "ruleName": "Rule name",
                        "status": "Pass" | "Fail",
                        "reason": "Brief reason",
                        "mandatory": true | false
                    }
                ],
                "mandatoryFailed": true | false,
                "failedMandatoryRules": ["name of any mandatory rule that failed"],
                "scoringBreakdown": {
                    "strategicAlignment": { "score": 1-5, "reason": "Brief justification" },
                    "regulatoryRisk": { "score": 1-5, "reason": "Brief justification" },
                    "businessImpact": { "score": 1-5, "reason": "Brief justification" },
                    "implementationComplexity": { "score": 1-5, "reason": "Brief justification" },
                    "timeToValue": { "score": 1-5, "reason": "Brief justification" },
                    "resourceRequirements": { "score": 1-5, "reason": "Brief justification" }
                },
                "priorityScore": 1.0,
                "calculatedTier": 1,
                "summary": "Overall summary of the analysis including scoring rationale"
            }
            `;

            return await this.createCompletion([
                {
                    role: 'system',
                    content: 'You analyze AI initiatives for a financial institution. Always respond with valid JSON only.'
                },
                { role: 'user', content: prompt }
            ]);
        } catch (error) {
            console.error('OpenAI Analysis Error:', error);
            throw new Error('Failed to analyze project');
        }
    }

    async analyzePriorityOnly(projectContext) {
        try {
            const rubric = loadScoringRubric();
            const scoringSection = rubric ? `
            Use these rubric definitions to score each dimension from 1-5:

            ${rubric.lines}
            ` : `
            Score each dimension 1-5:
            Strategic Alignment, Regulatory Risk, Business Impact,
            Implementation Complexity, Time-to-Value, Resource Requirements.
            `;

            const prompt = `
            You are a strict AI Initiative Approver for Sterling Financial Holdings Group.
            Evaluate the initiative context and produce only the scoring breakdown.

            === INITIATIVE CONTEXT ===
            ${projectContext}

            === TASK ===
            ${scoringSection}

            Return strict JSON only:
            {
                "scoringBreakdown": {
                    "strategicAlignment": { "score": 1-5, "reason": "Brief justification" },
                    "regulatoryRisk": { "score": 1-5, "reason": "Brief justification" },
                    "businessImpact": { "score": 1-5, "reason": "Brief justification" },
                    "implementationComplexity": { "score": 1-5, "reason": "Brief justification" },
                    "timeToValue": { "score": 1-5, "reason": "Brief justification" },
                    "resourceRequirements": { "score": 1-5, "reason": "Brief justification" }
                },
                "summary": "Short summary of scoring rationale"
            }
            `;

            return await this.createCompletion([
                {
                    role: 'system',
                    content: 'You evaluate initiative scoring dimensions. Return valid JSON only.'
                },
                { role: 'user', content: prompt }
            ], { temperature: this.config.temperatures.priority });
        } catch (error) {
            console.error('OpenAI Priority-Only Analysis Error:', error);
            throw new Error('Failed to analyze priority scoring');
        }
    }

    async evaluateSingleRule(projectContext, rule, options = {}) {
        try {
            const category = inferCategory(rule);
            const ruleId = (rule._id || '').toString();
            const criteria = rule.criteria || rule.description || '';
            const mandatoryTag = rule.isMandatory ? '[MANDATORY]' : '[OPTIONAL]';
            const triggerStyle = isTriggerCategory(category);
            const retrievedContext = String(options?.retrievedContext || '').trim();
            const retrievedSection = retrievedContext
                ? `\n            === RETRIEVED SUPPORTING CONTEXT (VECTOR SEARCH) ===\n            ${retrievedContext}\n`
                : '';
            const categoryDecisionGuide = triggerStyle
                ? 'For this category, treat the rule as a trigger condition: Pass when condition is NOT present; Fail only when condition IS present.'
                : 'For this category, treat the rule as a requirement: Pass when requirement is satisfied; Fail when not satisfied.';

            const prompt = `
            You are a strict AI Initiative Approver for Sterling Financial Holdings Group.
            Evaluate one rule against the initiative context.

            === RULE ===
            Rule ID: ${ruleId}
            Rule Name: ${rule.name}
            Category: ${category}
            Mandatory: ${mandatoryTag}
            Criteria: ${criteria}

            === INITIATIVE CONTEXT ===
            ${projectContext}
            ${retrievedSection}

            === DECISION INSTRUCTIONS ===
            - Return exactly one decision for this rule.
            - ${categoryDecisionGuide}
            - Use retrieved supporting context when present. If retrieved context conflicts with full context, prefer explicit facts from the full context.
            - If uncertain, still return a best-judgment Pass or Fail with concise reason.
            - Ensure status is logically consistent with the reason.
            - "conditionPresent" must be:
              * true if trigger condition is present (for trigger-style categories),
              * false if trigger condition is absent (for trigger-style categories),
              * false for non-trigger categories.

            Return strict JSON only:
            {
                "ruleId": "${ruleId}",
                "ruleName": "${rule.name}",
                "status": "Pass" | "Fail",
                "conditionPresent": true | false,
                "reason": "Brief reason",
                "mandatory": ${rule.isMandatory === true ? 'true' : 'false'}
            }
            `;

            return await this.createCompletion([
                {
                    role: 'system',
                    content: 'You evaluate one policy rule at a time. Return valid JSON only.'
                },
                { role: 'user', content: prompt }
            ], { temperature: this.config.temperatures.rules });
        } catch (error) {
            console.error('OpenAI Single-Rule Evaluation Error:', error);
            throw new Error('Failed to evaluate rule');
        }
    }

    async summarizeFinalDecision(projectContext, payload) {
        try {
            const prompt = `
            You are a strict AI Initiative Approver for Sterling Financial Holdings Group.
            Write a concise executive summary using the structured analysis payload.

            === INITIATIVE CONTEXT ===
            ${projectContext}

            === ANALYSIS PAYLOAD ===
            ${JSON.stringify(payload, null, 2)}

            Output requirements:
            - 1 short paragraph.
            - Mention strongest positives and key concerns.
            - Mention score and tier in plain language.
            - Priority Score is on a 1-5 scale. If you mention it, format as "X.YY/5.0".
            - Do not use "/10" or "out of 10".
            - Do not invent facts.
            `;

            const content = await this.createCompletion([
                {
                    role: 'system',
                    content: 'You summarize initiative analysis clearly and concisely.'
                },
                { role: 'user', content: prompt }
            ], { parseJson: false, temperature: this.config.temperatures.summary });

            return stripCodeBlocks(content);
        } catch (error) {
            console.error('OpenAI Final Summary Error:', error);
            return '';
        }
    }

    async analyzeRulesOnly(projectContext, rules) {
        try {
            const rulePrompts = buildRulePrompts(rules);

            const prompt = `
            You are a strict AI Initiative Approver for Sterling Financial Holdings Group.
            Evaluate the initiative against all listed rules.

            === APPROVAL RULES ===
            ${rulePrompts}

            === INITIATIVE CONTEXT ===
            ${projectContext}

            Return one rulesAnalysis entry for every rule listed above.
            You must not skip any rule.
            If uncertain, still return Pass or Fail with a short reason.
            For ESCALATION, PENALTY, CAP, and BOOST rules:
            Pass means trigger condition is NOT present; Fail means trigger condition IS present.

            Return strict JSON only:
            {
                "rulesAnalysis": [
                    {
                        "ruleId": "exact Rule ID from input",
                        "ruleName": "Rule name",
                        "status": "Pass" | "Fail",
                        "reason": "Brief reason",
                        "mandatory": true | false
                    }
                ]
            }
            `;

            return await this.createCompletion([
                {
                    role: 'system',
                    content: 'You analyze AI initiatives for a financial institution. Always respond with valid JSON only.'
                },
                { role: 'user', content: prompt }
            ]);
        } catch (error) {
            console.error('OpenAI Rules-Only Analysis Error:', error);
            throw new Error('Failed to analyze rules');
        }
    }
}

module.exports = new OpenAIService();
