const jwt = require('jsonwebtoken');

const SECRET_KEY = 'your_secret_key'; // Thay bằng secret key của bạn
const REFRESH_SECRET_KEY = 'your_refresh_secret_key'; // Thay bằng secret key cho Refresh Token

// Tạo Access Token
function generateToken(payload, expiresIn = '1h') {
    return jwt.sign(payload, SECRET_KEY, { expiresIn });
}

// Tạo Refresh Token
function generateRefreshToken(payload, expiresIn = '7d') {
    return jwt.sign(payload, REFRESH_SECRET_KEY, { expiresIn });
}

// Xác thực Access Token
function verifyToken(token) {
    try {
        return jwt.verify(token, SECRET_KEY);
    } catch (error) {
        throw new Error('Invalid or expired token');
    }
}

// Xác thực Refresh Token
function verifyRefreshToken(token) {
    try {
        return jwt.verify(token, REFRESH_SECRET_KEY);
    } catch (error) {
        throw new Error('Invalid or expired refresh token');
    }
}

module.exports = { generateToken, generateRefreshToken, verifyToken, verifyRefreshToken };