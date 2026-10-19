'use strict';
const { DomainError, number, hash, validateScoring, validateWeights } = require('../../contracts/competency');
const gcd = (a,b) => { a = a < 0n ? -a : a; while (b) { const t = a % b; a = b; b = t; } return a || 1n; };
class Rational {
  constructor(n,d=1n) { if (!d) throw new Error('Zero denominator'); if (d<0n) { n=-n; d=-d; } const g=gcd(n,d); this.n=n/g; this.d=d/g; }
  static from(value) { number(value,'Scoring value',{ min:-1e9 }); return new Rational(BigInt(Math.round(value*1e6)),1000000n); }
  add(v) { return new Rational(this.n*v.d+v.n*this.d,this.d*v.d); }
  mul(v) { return new Rational(this.n*v.n,this.d*v.d); }
  div(v) { return new Rational(this.n*v.d,this.d*v.n); }
  rounded(places=12) { const p=10n**BigInt(places); const absolute=this.n<0n?-this.n:this.n; const integer=(absolute*p*2n+this.d)/(2n*this.d); return Number(this.n<0n?-integer:integer)/Number(p); }
}
const zero = () => new Rational(0n);
function measure(definition, criterion) {
  const nativeId=criterion.nativeCriterionId || criterion.criterionId;
  const entry=definition.scoringConfig.normalization.find(value => value.sourceVersionId===criterion.sourceVersionId && value.criterionId===nativeId);
  if (!entry) throw new DomainError(422,'MISSING_NORMALIZATION',`Configure scoring for ${criterion.name || criterion.id}.`);
  return entry;
}
function evaluateFinding(definition,criterion,finding) {
  const entry=measure(definition,criterion);
  if (finding?.status!=='assessed') return null;
  if (entry.method==='level_map') {
    if (finding.rating!==undefined && finding.rating!==null) throw new DomainError(422,'AMBIGUOUS_MEASURE','Use a native level for this criterion, without a numeric rating.');
    if (!(criterion.levelIds || criterion.levels?.map(level=>level.id) || []).includes(finding.observedLevelId) || !Object.hasOwn(entry.levelScores,finding.observedLevelId)) throw new DomainError(422,'INVALID_OBSERVED_LEVEL','Select a mapped level from this criterion’s source framework.');
    const expected=criterion.expectedLevelId && entry.levelScores[criterion.expectedLevelId];
    return { value:Rational.from(entry.levelScores[finding.observedLevelId]), observedLevelId:finding.observedLevelId, expectedLevelId:criterion.expectedLevelId || null, gap:typeof expected==='number'?entry.levelScores[finding.observedLevelId]-expected:null, measure:'level_map' };
  }
  if (finding.observedLevelId) throw new DomainError(422,'AMBIGUOUS_MEASURE','Use the configured numeric rating for this criterion.');
  const scale=definition.scoringConfig.ratingScales.find(item=>item.id===entry.ratingScaleId);
  if (!scale) throw new DomainError(422,'UNKNOWN_SCALE','The configured rating scale is unavailable.');
  number(finding.rating,'Rating',{min:scale.min,max:scale.max});
  const range=Rational.from(scale.max).add(Rational.from(-scale.min));
  return { value:Rational.from(finding.rating).add(Rational.from(-scale.min)).div(range).mul(Rational.from(100)), rating:finding.rating, scale, expectedTarget:criterion.evaluationTarget || null, gap:criterion.evaluationTarget?Rational.from(finding.rating).add(Rational.from(-criterion.evaluationTarget.value)).rounded():null, measure:'rating_scale' };
}
function compatibilityKey(definition) {
  return hash({role:{roleId:definition.role.roleId,version:definition.role.version,criteria:definition.criteria},sources:definition.selectedInputTypes,frameworks:definition.frameworks?.map(value=>({id:value.id,contentHash:value.contentHash})),strategies:definition.strategies?.map(value=>({id:value.id,contentHash:value.contentHash})),scoring:definition.scoringConfig,ranking:definition.rankingConfig});
}
function calculate(definition,items=[],exceptions=[]) {
  validateScoring(definition.scoringConfig,definition.selectedInputTypes);
  const config=definition.scoringConfig, sources=[], breakdown=[], exclusions=[],sourceDenominators=new Map();
  const configuredInputTotal=Object.values(config.inputWeights).reduce((sum,value)=>sum.add(Rational.from(value)),zero());
  const exceptionIds=new Set(exceptions.map(value=>value.criterionId));
  let total=zero(),overallDenominator=zero(),weightedSelected=zero(),weightedAssessed=zero();
  let required=0,assessedRequired=0,unscored=false;
  for (const source of definition.selectedInputTypes) {
    const criteria=definition.criteria.filter(value=>value.sourceType===source);
    validateWeights(Object.fromEntries(criteria.map(value=>[value.id,value.weight])),config.weightMode,`${source} criterion weights`);
    const selectedWeight=criteria.reduce((sum,item)=>sum.add(Rational.from(item.weight)),zero());
    let numerator=zero(),denominator=zero();
    for (const criterion of criteria) {
      const finding=items.find(item=>item.criterionId===criterion.id);
      if (criterion.required) required++;
      const evaluated=exceptionIds.has(criterion.id)?null:evaluateFinding(definition,criterion,finding);
      const weight=Rational.from(criterion.weight);
      const effective=weight.div(selectedWeight).mul(Rational.from(config.inputWeights[source])).div(configuredInputTotal);
      weightedSelected=weightedSelected.add(effective);
      if (!evaluated) {
        const exception=exceptionIds.has(criterion.id);
        exclusions.push({criterionId:criterion.id,sourceType:source,reason:finding?.status==='insufficient_evidence'?'insufficient_evidence':'not_assessed',authorisedException:exception,weight:criterion.weight,policy:config.exceptionPolicy});
        if (criterion.required && (!exception || config.exceptionPolicy==='retain_as_unscored')) unscored=true;
        breakdown.push({criterionId:criterion.id,sourceType:source,score:null,effectiveWeight:effective.rounded(),weight:criterion.weight,excluded:true});
        continue;
      }
      if (criterion.required) assessedRequired++;
      numerator=numerator.add(evaluated.value.mul(weight)); denominator=denominator.add(weight); weightedAssessed=weightedAssessed.add(effective);
      const {value,...rest}=evaluated;
      breakdown.push({criterionId:criterion.id,sourceType:source,score:value.rounded(),displayScore:value.rounded(2),effectiveWeight:effective.rounded(),weight:criterion.weight,...rest});
    }
    const score=denominator.n?numerator.div(denominator):null;
    sourceDenominators.set(source,denominator);
    sources.push({sourceType:source,score:score?score.rounded():null,weight:config.inputWeights[source],selectedWeight:selectedWeight.rounded(),scoredWeight:denominator.rounded(),effectiveWeight:0});
    if (score) { const weight=Rational.from(config.inputWeights[source]); total=total.add(score.mul(weight)); overallDenominator=overallDenominator.add(weight); }
    else if(config.exceptionPolicy==='retain_as_unscored') unscored=true;
  }
  const overall=!unscored && overallDenominator.n?total.div(overallDenominator).rounded():null;
  sources.forEach(source=>{source.effectiveWeight=overallDenominator.n && source.score!==null?Rational.from(source.weight).div(overallDenominator).rounded():0;});
  for(const criterion of breakdown){criterion.configuredEffectiveWeight=criterion.effectiveWeight;const source=sources.find(value=>value.sourceType===criterion.sourceType),denominator=sourceDenominators.get(criterion.sourceType);criterion.effectiveWeight=criterion.score!==null&&denominator.n&&overallDenominator.n?Rational.from(criterion.weight).div(denominator).mul(Rational.from(source.weight)).div(overallDenominator).rounded():0;}
  const suggested=overall===null?null:config.thresholds.find(band=>overall>=band.minInclusive && (band.maxExclusive!==undefined?overall<band.maxExclusive:overall<=band.maxInclusive));
  const score={overallScore:overall,displayScore:overall===null?null:new Rational(BigInt(Math.round(overall*1e12)),1000000000000n).rounded(2),sourceScores:sources,criterionScores:breakdown,coverage:{required,assessedRequired,selected:definition.criteria.length,assessed:breakdown.filter(item=>item.score!==null).length,weighted:weightedSelected.n?weightedAssessed.div(weightedSelected).rounded():0},formula:{method:'weighted_mean',calculationPrecision:12,displayPrecision:2,rounding:'half_up',inputDenominator:overallDenominator.rounded(),exceptionPolicy:config.exceptionPolicy},exclusions};
  return {score,suggestedOutcome:suggested?{id:suggested.id,label:suggested.label}:null,scoreHash:hash(score),compatibilityKey:compatibilityKey(definition)};
}
function rankResults(records,config) {
  if (!config.enabled) return [];
  const comparable=records.filter(record=>typeof record.score?.overallScore==='number').map(record=>({...record,tieValue:new Rational(BigInt(Math.round(record.score.overallScore*1e12)),1000000000000n).rounded(config.decimalPlaces)})).sort((a,b)=>config.direction==='asc'?a.tieValue-b.tieValue:b.tieValue-a.tieValue);
  let rank=0,prior;
  return comparable.map((record,index)=>{ if(index===0||record.tieValue!==prior) rank=config.tieRule==='dense'?rank+1:index+1; prior=record.tieValue; return {...record,rank}; });
}
module.exports={calculate,evaluateFinding,compatibilityKey,rankResults,Rational};
