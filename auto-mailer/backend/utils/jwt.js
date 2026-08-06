import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.SECRET_KEY || (isProduction ? null : 'dev-only-secret-key-change-me');
const JWT_EXPIRE = process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 120;

if (!JWT_SECRET) {
  throw new Error('SECRET_KEY is not defined in environment variables');
}

if (!process.env.SECRET_KEY && !isProduction) {
  console.warn('⚠️  SECRET_KEY is not set. Using insecure development fallback key.');
}

export const generateToken = (payload) => {
  try {
    return jwt.sign(
      payload,
      JWT_SECRET,
      {
        expiresIn: `${JWT_EXPIRE}m`,
        algorithm: process.env.ALGORITHM || 'HS256'
      }
    );
  } catch (error) {
    throw new Error('Error generating token: ' + error.message);
  }
};

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    } else {
      throw new Error('Token verification failed: ' + error.message);
    }
  }
};

export const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    throw new Error('Error decoding token: ' + error.message);
  }
};

export const generateRefreshToken = (payload) => {
  try {
    return jwt.sign(
      payload,
      JWT_SECRET,
      {
        expiresIn: '7d', // Refresh tokens last longer
        algorithm: process.env.ALGORITHM || 'HS256'
      }
    );
  } catch (error) {
    throw new Error('Error generating refresh token: ' + error.message);
  }
};
