import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Mock API endpoints for demonstration
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'API is working' });
});

// Auth endpoints
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  // Mock authentication
  if (email === 'admin@petrolpump.com' && password === 'admin123') {
    res.json({
      success: true,
      data: {
        token: 'mock-jwt-token-12345',
        user: {
          id: '1',
          email: 'admin@petrolpump.com',
          username: 'admin',
          firstName: 'Admin',
          lastName: 'User',
          role: 'OWNER'
        }
      }
    });
  } else {
    res.status(401).json({
      success: false,
      error: 'Invalid credentials'
    });
  }
});

// Dashboard summary endpoint
app.get('/api/dashboard/summary', (req, res) => {
  res.json({
    success: true,
    data: {
      activeShifts: {
        count: 2,
        shifts: [
          { id: '1', staffName: 'John Doe' },
          { id: '2', staffName: 'Jane Smith' }
        ]
      },
      todayStats: {
        completedShifts: 5,
        totalCashCollected: 45000,
        expectedCash: 44500,
        totalVariance: 500,
        variancePercentage: '1.12'
      },
      fuelSales: {
        MS: { totalLiters: 1250.5, totalRevenue: 128175 },
        HSD: { totalLiters: 980.2, totalRevenue: 87968 }
      },
      alerts: [
        {
          variance: 250,
          expectedCash: 12000,
          variancePercentage: '2.08',
          timestamp: new Date().toISOString(),
          staffName: 'John Doe',
          type: 'excess'
        }
      ]
    }
  });
});

// Dispensers endpoint
app.get('/api/dispensers', (req, res) => {
  res.json({
    success: true,
    data: [
      {
        id: '1',
        name: 'Nozzle-1A',
        unitNumber: 'Nozzle-1A',
        fuelType: 'MS',
        ratePerLiter: 102.50,
        isActive: true,
        lastReading: 1000.50
      },
      {
        id: '2',
        name: 'Nozzle-1B',
        unitNumber: 'Nozzle-1B',
        fuelType: 'MS',
        ratePerLiter: 102.50,
        isActive: true,
        lastReading: 950.25
      },
      {
        id: '3',
        name: 'Nozzle-2A',
        unitNumber: 'Nozzle-2A',
        fuelType: 'HSD',
        ratePerLiter: 89.75,
        isActive: true,
        lastReading: 1200.00
      }
    ]
  });
});

// Shifts endpoint
app.get('/api/shifts', (req, res) => {
  const { action } = req.query;
  
  if (action === 'current') {
    res.json({
      success: true,
      data: {
        id: '1',
        userId: '1',
        staffName: 'Current User',
        startTime: new Date().toISOString(),
        status: 'ACTIVE'
      }
    });
  } else {
    res.json({
      success: true,
      data: []
    });
  }
});

// Readings endpoint
app.post('/api/readings', (req, res) => {
  res.json({
    success: true,
    data: {
      id: '1',
      message: 'Reading added successfully'
    }
  });
});

app.get('/api/readings', (req, res) => {
  res.json({
    success: true,
    data: []
  });
});

// Default route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Petrol Pump Management API',
    endpoints: ['/api/auth/login', '/api/dashboard/summary', '/api/dispensers']
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Mock API server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:5173`);
  console.log(`🔑 Demo credentials: admin@petrolpump.com / admin123`);
});