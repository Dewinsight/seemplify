import { User } from '../models/User.js';
import { generateToken } from '../utils/jwt.js';
import validator from 'validator';

export const register = async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    // Validation
    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create new user
    const newUser = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password
    });

    const result = await newUser.save();

    // Generate JWT token
    const token = generateToken({
      userId: result.insertedId.toString(),
      email: email.toLowerCase().trim()
    });

    // Get user data for response (without password)
    const userData = await User.findById(result.insertedId.toString());
    const sanitizedUser = User.sanitize(userData);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: sanitizedUser,
        token,
        expiresIn: `${process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 120}m`
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error during registration'
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // Find user by email
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Verify password
    const isPasswordValid = await User.verifyPassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate JWT token
    const token = generateToken({
      userId: user._id.toString(),
      email: user.email
    });

    // Return user data (without password)
    const sanitizedUser = User.sanitize(user);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: sanitizedUser,
        token,
        expiresIn: `${process.env.ACCESS_TOKEN_EXPIRE_MINUTES || 120}m`
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during login'
    });
  }
};

export const getProfile = async (req, res) => {
  try {
    // User is already attached to req by auth middleware
    const user = await User.findById(req.user._id.toString());
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const sanitizedUser = User.sanitize(user);

    res.json({
      success: true,
      data: {
        user: sanitizedUser
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching profile'
    });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.user._id.toString();

    // Validation
    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }

    // Update user
    const updateResult = await User.updateById(userId, {
      name: name.trim()
    });

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get updated user data
    const updatedUser = await User.findById(userId);
    const sanitizedUser = User.sanitize(updatedUser);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: sanitizedUser
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating profile'
    });
  }
};

export const logout = async (req, res) => {
  try {
    // In a stateless JWT setup, logout is handled client-side by removing the token
    // For additional security, you could maintain a blacklist of tokens
    
    res.json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during logout'
    });
  }
};
