import type { User, Location } from '../../shared/types.js';
import { hashPassword } from '../../shared/constants.js';
import { generateId, nowISO } from './db.js';

export const createInitialUsers = (): User[] => [
  {
    id: generateId(),
    username: 'admin',
    role: 'admin',
    displayName: '系统管理员',
    passwordHash: hashPassword('123456'),
    createdAt: nowISO(),
  },
  {
    id: generateId(),
    username: 'collector01',
    role: 'collector',
    displayName: '张采集',
    passwordHash: hashPassword('123456'),
    createdAt: nowISO(),
  },
  {
    id: generateId(),
    username: 'warehouse01',
    role: 'warehouse',
    displayName: '李库管',
    passwordHash: hashPassword('123456'),
    createdAt: nowISO(),
  },
  {
    id: generateId(),
    username: 'tester01',
    role: 'tester',
    displayName: '王检测',
    passwordHash: hashPassword('123456'),
    createdAt: nowISO(),
  },
  {
    id: generateId(),
    username: 'auditor01',
    role: 'auditor',
    displayName: '赵审核',
    passwordHash: hashPassword('123456'),
    createdAt: nowISO(),
  },
];

export const createInitialLocations = (): Location[] => {
  const now = nowISO();
  return [
    {
      id: generateId(),
      code: 'WH-A-01',
      name: 'A区存储库位01',
      type: 'storage',
      capacity: 50,
      status: 'active',
      description: 'A区1号常温存储架',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId(),
      code: 'WH-A-02',
      name: 'A区存储库位02',
      type: 'storage',
      capacity: 50,
      status: 'active',
      description: 'A区2号常温存储架',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId(),
      code: 'WH-B-01',
      name: 'B区冷藏库位01',
      type: 'storage',
      capacity: 30,
      status: 'active',
      description: 'B区1号冷藏存储柜（2-8℃）',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId(),
      code: 'WH-B-02',
      name: 'B区冷藏库位02',
      type: 'storage',
      capacity: 30,
      status: 'inactive',
      description: 'B区2号冷藏存储柜（维护中）',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId(),
      code: 'LAB-01',
      name: '检测实验室01',
      type: 'testing',
      capacity: 100,
      status: 'active',
      description: '一号检测实验室接收区',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId(),
      code: 'LAB-02',
      name: '检测实验室02',
      type: 'testing',
      capacity: 100,
      status: 'active',
      description: '二号检测实验室接收区',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId(),
      code: 'ARC-01',
      name: '长期归档区',
      type: 'archive',
      capacity: 500,
      status: 'active',
      description: '样本长期归档保存区',
      createdAt: now,
      updatedAt: now,
    },
  ];
};

export const seedIfEmpty = (db: { users: User[]; locations: Location[] }) => {
  const needsSeed = db.users.length === 0 || db.locations.length === 0;
  return { needsSeed };
};
