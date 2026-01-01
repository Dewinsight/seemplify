import mongoose from 'mongoose'

const itemSchema = new mongoose.Schema({
  _id: { type: String },
  payload: { type: Object },
  expiresAt: { type: Date },
  consumedAt: { type: Date },
  grantId: { type: String, index: true },
  userCode: { type: String, index: true },
  uid: { type: String, index: true }
}, { minimize: false })

function getModel(name) {
  return mongoose.models[`oidc_${name}`] || mongoose.model(`oidc_${name}`, itemSchema)
}

export class MongoAdapter {
  constructor(name) {
    this.name = name
    this.Model = getModel(name)
  }

  async upsert(id, payload, expiresIn) {
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined
    await this.Model.updateOne({ _id: id }, { _id: id, payload, expiresAt, grantId: payload.grantId, userCode: payload.userCode, uid: payload.uid }, { upsert: true })
  }

  async find(id) {
    const result = await this.Model.findById(id).lean()
    if (!result) return undefined
    return result.payload
  }

  async findByUserCode(userCode) {
    const result = await this.Model.findOne({ userCode }).lean()
    if (!result) return undefined
    return result.payload
  }

  async findByUid(uid) {
    const result = await this.Model.findOne({ uid }).lean()
    if (!result) return undefined
    return result.payload
  }

  async destroy(id) {
    await this.Model.deleteOne({ _id: id })
  }

  async revokeByGrantId(grantId) {
    await this.Model.deleteMany({ grantId })
  }

  async consume(id) {
    await this.Model.updateOne({ _id: id }, { $set: { consumedAt: new Date() } })
  }
}

