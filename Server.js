// Server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const { generateToken, generateRefreshToken, verifyToken, verifyRefreshToken } = require('./Utils/jwtUtils');
const uploadRouter = require('./Utils/upload'); // router upload

const app = express();
const port = 5000;

// ===================== Config chung =====================
const dbName = 'db0';
const productCollectionName = 'product';
const userCollectionName = 'user';
const orderCollectionName = 'order';

// ===================== Middleware =====================
app.use(bodyParser.json());
app.use(cors());

// ===================== Logger đơn giản (console-only) =====================
const DEBUG_STACK = (process.env.DEBUG_STACK || 'false').toLowerCase() === 'true';

function maskUri(uri) {
  try {
    return uri.replace(
      /(mongodb\+srv:\/\/[^:]+:)([^@]+)(@.+)/,
      (_, a, _pwd, c) => `${a}***${c}`
    );
  } catch { return uri; }
}
function logInfo(...args) { console.log('[INFO]', ...args); }
function logErr(ctx, err) {
  console.error('[ERR]', ctx, {
    name: err?.name,
    code: err?.code,
    codeName: err?.codeName,
    message: err?.message,
    stack: DEBUG_STACK ? err?.stack : undefined,
  });
}

// ===================== MongoDB connection (console debug) =====================
// Ưu tiên ENV, fallback chuỗi cũ (bạn nên chuyển lên ENV: MONGODB_URI)
const RAW_URI = process.env.MONGODB_URI
  || 'mongodb+srv://hieubui2004:hieubui2004@cluster0.8gaa8yx.mongodb.net/?appName=Cluster0';

// đảm bảo có /db0 trong URI (Atlas auth dùng DB trong URI)
const uri = (function ensureDbInUri(u, db) {
  try {
    const idx = u.indexOf('.net/');
    if (idx < 0) return u; // không phải cluster URI chuẩn
    const after = u.slice(idx + 5); // phần sau ".net/"
    if (!after || after.startsWith('?')) {
      // thiếu /<db> → chèn vào
      return u.replace('.net/', `.net/${db}`);
    }
    return u;
  } catch { return u; }
})(RAW_URI, dbName);

const client = new MongoClient(uri, { maxPoolSize: 10 });
let __mongoReady = false;

async function initMongoOnce() {
  if (__mongoReady) return;
  logInfo('Mongo connecting to:', maskUri(uri));
  try {
    await client.connect();
    await client.db(dbName).command({ ping: 1 }); // ping để xác thực auth + network
    __mongoReady = true;
    logInfo(`Mongo connected & ping OK → DB "${dbName}"`);
  } catch (err) {
    logErr('Mongo connect/ping failed', err);
    // Không throw để server vẫn lên, bạn sẽ thấy lỗi ở console
    // Nếu muốn dừng hẳn khi DB fail: uncomment dòng dưới
    // process.exit(1);
  }
}

// connect lấy collection (đảm bảo đã init/ping)
async function connectToDatabase(collectionName) {
  if (!__mongoReady) {
    await initMongoOnce();
  }
  return client.db(dbName).collection(collectionName);
}

// Khởi tạo kết nối ngay khi start server
initMongoOnce();

// ===================== Category mapping =====================
const categoryMapping = {
  FAST: 'Món ăn nhanh',
  BEVE: 'Đồ uống',
  DESS: 'Đồ ngọt',
  MAIN: 'Món chính',
  SNAK: 'Đồ ăn vặt',
  VEGE: 'Đồ chay',
  COBO: 'Combo',
};

// ===================== Auth middleware =====================
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token is required' });

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('[AUTH] JWT verification failed:', error.message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ===================== Routes =====================

// Đăng nhập
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const collection = await connectToDatabase(userCollectionName);
    const user = await collection.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ error: 'Invalid email or password' });

    // Thêm role vào refresh token để tránh thiếu role ở bước refresh
    const accessToken = generateToken({ id: user.id, email: user.email, role: user.role });
    const refreshToken = generateRefreshToken({ id: user.id, email: user.email, role: user.role });

    console.log('[LOGIN] Access Token:', accessToken);
    console.log('[LOGIN] Refresh Token:', refreshToken);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: true, // chỉ bật khi HTTPS; nếu dev HTTP có thể tắt
      sameSite: 'strict',
    });

    res.status(200).json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    logErr('[/api/login]', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Đăng ký
app.post('/api/register', async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email và mật khẩu là bắt buộc' });

  try {
    const collection = await connectToDatabase(userCollectionName);

    const existingUser = await collection.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email đã được sử dụng' });

    const userId = await generateUserId();
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: userId,
      email,
      password: hashedPassword,
      role: role || 'user',
      created_at: new Date(),
    };

    const result = await collection.insertOne(newUser);
    res.status(201).json({ message: 'Đăng ký thành công', userId: result.insertedId });
  } catch (error) {
    logErr('[/api/register]', error);
    res.status(500).json({ error: 'Đăng ký thất bại' });
  }
});

// Refresh token
app.post('/api/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: 'Refresh token is required' });

  try {
    const decoded = verifyRefreshToken(refreshToken);
    const accessToken = generateToken({ id: decoded.id, email: decoded.email, role: decoded.role });
    res.status(200).json({ accessToken });
  } catch (error) {
    console.error('[REFRESH]', error.message);
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// Upload router
app.use('/api', uploadRouter);

// Sinh ID sản phẩm (từ dữ liệu hiện có)
async function generateProductId(category) {
  try {
    const collection = await connectToDatabase(productCollectionName);
    const lastProduct = await collection
      .find({ ID: { $regex: `^FOOD${category}` } })
      .sort({ ID: -1 })
      .limit(1)
      .toArray();

    let lastIdNumber = 0;
    if (lastProduct.length > 0) {
      const lastId = lastProduct[0].ID;
      lastIdNumber = parseInt(lastId.slice(-4), 10);
    }
    const newIdNumber = lastIdNumber + 1;
    return `FOOD${category}${newIdNumber.toString().padStart(4, '0')}`;
  } catch (error) {
    logErr('[generateProductId]', error);
    throw new Error('Không thể tạo ID sản phẩm');
  }
}

// Sinh ID user
async function generateUserId() {
  try {
    const collection = await connectToDatabase(userCollectionName);
    const lastUser = await collection
      .find({ id: { $regex: /^user\d{4}$/ } })
      .sort({ id: -1 })
      .limit(1)
      .toArray();

    let lastIdNumber = 0;
    if (lastUser.length > 0) {
      const lastId = lastUser[0].id;
      lastIdNumber = parseInt(lastId.slice(-4), 10);
    }
    const newIdNumber = lastIdNumber + 1;
    return `user${newIdNumber.toString().padStart(4, '0')}`;
  } catch (error) {
    logErr('[generateUserId]', error);
    throw new Error('Không thể tạo ID người dùng');
  }
}

// CREATE: Product
app.post('/api/products', async (req, res) => {
  try {
    const collection = await connectToDatabase(productCollectionName);
    const { Ảnh, Tên, Cửa_Hàng, Trạng_Thái, Danh_Mục, Giá, Mô_tả } = req.body;

    if (!Ảnh || !Tên || !Cửa_Hàng || !Trạng_Thái || !Danh_Mục || !Giá || !Mô_tả) {
      return res.status(400).json({ error: 'Thiếu thông tin sản phẩm!' });
    }

    const mappedCategory = categoryMapping[Danh_Mục];
    if (!mappedCategory) {
      return res.status(400).json({ error: 'Danh mục không hợp lệ!' });
    }

    const newId = await generateProductId(Danh_Mục);

    const newProduct = {
      ID: newId,
      Ảnh,
      Tên,
      Cửa_Hàng,
      Trạng_Thái,
      Danh_Mục: mappedCategory,
      Giá: parseInt(Giá, 10),
      Mô_tả,
    };

    const result = await collection.insertOne(newProduct);
    res.status(201).json({ message: 'Product created successfully', productId: result.insertedId });
  } catch (error) {
    logErr('[/api/products][POST]', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// GET: new product ID
app.get('/api/products/new-id', async (req, res) => {
  try {
    const category = req.query.category;
    if (!category) return res.status(400).json({ error: 'Danh mục là bắt buộc' });

    const newId = await generateProductId(category);
    res.status(200).json({ newId });
  } catch (error) {
    logErr('[/api/products/new-id]', error);
    res.status(500).json({ error: 'Không thể tạo ID mới' });
  }
});

// READ all products
app.get('/api/products', async (req, res) => {
  try {
    const collection = await connectToDatabase(productCollectionName);
    const products = await collection.find({}).toArray();
    res.status(200).json(products);
  } catch (error) {
    logErr('[/api/products][GET ALL]', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// READ product by ID (custom field "ID")
app.get('/api/products/:id', async (req, res) => {
  try {
    const collection = await connectToDatabase(productCollectionName);
    const product = await collection.findOne({ ID: req.params.id });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.status(200).json(product);
  } catch (error) {
    logErr('[/api/products/:id][GET]', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// UPDATE product by ID
app.put('/api/products/:id', async (req, res) => {
  const { ID, Ảnh, Tên, Cửa_Hàng, Trạng_Thái, Danh_Mục, Giá, Mô_tả } = req.body;
  if (!ID || !Ảnh || !Tên || !Cửa_Hàng || !Trạng_Thái || !Danh_Mục || !Giá || !Mô_tả) {
    return res.status(400).json({ error: 'Thiếu thông tin sản phẩm!' });
  }

  try {
    const collection = await connectToDatabase(productCollectionName);
    const result = await collection.updateOne(
      { ID: req.params.id },
      { $set: { ID, Ảnh, Tên, Cửa_Hàng, Trạng_Thái, Danh_Mục, Giá, Mô_tả } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Không tìm thấy sản phẩm!' });
    res.status(200).json({ message: 'Cập nhật sản phẩm thành công!' });
  } catch (error) {
    logErr('[/api/products/:id][PUT]', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// DELETE product by ID
app.delete('/api/products/:id', async (req, res) => {
  try {
    const collection = await connectToDatabase(productCollectionName);
    const result = await collection.deleteOne({ ID: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Product not found' });
    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (error) {
    logErr('[/api/products/:id][DELETE]', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// CREATE order
app.post('/api/orders', async (req, res) => {
  try {
    const collection = await connectToDatabase(orderCollectionName);
    const { order_id, user_id, food_id, quantity, total_price, order_time, status } = req.body;
    if (!order_id || !user_id || !food_id || !quantity || !total_price || !order_time || !status) {
      return res.status(400).json({ error: 'Thiếu thông tin order!' });
    }

    const newOrder = {
      order_id,
      user_id,
      food_id,
      quantity,
      total_price,
      order_time: new Date(order_time),
      status,
    };

    const result = await collection.insertOne(newOrder);
    res.status(201).json({ message: 'Order created successfully', orderId: result.insertedId });
  } catch (error) {
    logErr('[/api/orders][POST]', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// READ all orders
app.get('/api/orders', async (req, res) => {
  try {
    const collection = await connectToDatabase(orderCollectionName);
    const orders = await collection.find({}).toArray();
    res.status(200).json(orders);
  } catch (error) {
    logErr('[/api/orders][GET ALL]', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// READ one order by _id (ObjectId)
app.get('/api/orders/:id', async (req, res) => {
  try {
    const collection = await connectToDatabase(orderCollectionName);
    const order = await collection.findOne({ _id: new ObjectId(req.params.id) });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.status(200).json(order);
  } catch (error) {
    logErr('[/api/orders/:id][GET]', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// UPDATE one order by _id (ObjectId)
app.put('/api/orders/:id', async (req, res) => {
  const { order_id, user_id, food_id, quantity, total_price, order_time, status } = req.body;
  if (!order_id || !user_id || !food_id || !quantity || !total_price || !order_time || !status) {
    return res.status(400).json({ error: 'Thiếu thông tin order!' });
  }

  try {
    const collection = await connectToDatabase(orderCollectionName);
    const result = await collection.updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          order_id,
          user_id,
          food_id,
          quantity,
          total_price,
          order_time: new Date(order_time),
          status,
        },
      }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Order not found' });
    res.status(200).json({ message: 'Order updated successfully' });
  } catch (error) {
    logErr('[/api/orders/:id][PUT]', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// DELETE one order by _id (ObjectId)
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const collection = await connectToDatabase(orderCollectionName);
    const result = await collection.deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Order not found' });
    res.status(200).json({ message: 'Order deleted successfully' });
  } catch (error) {
    logErr('[/api/orders/:id][DELETE]', error);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

// GET: user profile
app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const collection = await connectToDatabase(userCollectionName);
    const user = await collection.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { password, ...userWithoutPassword } = user;
    res.status(200).json(userWithoutPassword);
  } catch (error) {
    logErr('[/api/user/profile][GET]', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// PUT: update user profile
app.put('/api/user/profile', authMiddleware, async (req, res) => {
  const { email, role } = req.body;
  try {
    const collection = await connectToDatabase(userCollectionName);
    const result = await collection.updateOne(
      { id: req.user.id },
      { $set: { email, role } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'User not found' });

    const updatedUser = await collection.findOne({ id: req.user.id });
    const { password, ...userWithoutPassword } = updatedUser;
    res.status(200).json(userWithoutPassword);
  } catch (error) {
    logErr('[/api/user/profile][PUT]', error);
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

// ===================== Global error handler (console-only) =====================
app.use((err, req, res, next) => {
  logErr(`${req.method} ${req.originalUrl}`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ===================== Start server =====================
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  // chủ động init để log ra console trạng thái DB khi start
  initMongoOnce();
});
