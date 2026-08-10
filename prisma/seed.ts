import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Password123', 10);

  const architect = await prisma.user.upsert({
    where: { email: 'architect@example.com' },
    update: {},
    create: {
      email: 'architect@example.com',
      name: 'Anita Deshmukh',
      passwordHash,
      role: 'ARCHITECT',
      firmName: 'Deshmukh Associates',
      councilRegNo: 'CA/2019/12345',
      phone: '+91 98200 11223',
    },
  });

  await prisma.user.upsert({
    where: { email: 'officer@cidco.example' },
    update: {},
    create: {
      email: 'officer@cidco.example',
      name: 'R. K. Patil',
      passwordHash,
      role: 'CIDCO_OFFICER',
    },
  });

  const projects = [
    { code: 'CIDCO-KHR-012', name: 'Kharghar Sector 12 Township', node: 'Kharghar', plotNumber: '12/A' },
    { code: 'CIDCO-ULW-045', name: 'Ulwe Node Residential Plot 45', node: 'Ulwe', plotNumber: '45' },
    { code: 'CIDCO-PNV-003', name: 'Panvel Commercial Complex', node: 'Panvel', plotNumber: '3' },
  ];
  for (const project of projects) {
    await prisma.project.upsert({ where: { code: project.code }, update: {}, create: project });
  }

  const existingReports = await prisma.report.count();
  if (existingReports === 0) {
    const kharghar = await prisma.project.findUnique({ where: { code: 'CIDCO-KHR-012' } });
    await prisma.report.createMany({
      data: [
        {
          referenceNo: 'CIDCO/AQI/2026/00001',
          userId: architect.id,
          projectId: kharghar?.id,
          source: 'WEB',
          status: 'APPROVED',
          siteName: 'Kharghar Sector 12 Site',
          location: 'Kharghar, Navi Mumbai',
          latitude: 19.033,
          longitude: 73.063,
          measuredAt: new Date('2026-07-28T09:30:00Z'),
          aqiValue: 148,
          pm25: 62.4,
          pm10: 120.5,
          remarks: 'Morning reading, construction active',
          reviewedBy: 'R. K. Patil',
          reviewNote: 'Verified against board photograph',
          reviewedAt: new Date('2026-07-29T06:00:00Z'),
        },
        {
          referenceNo: 'CIDCO/AQI/2026/00002',
          userId: architect.id,
          source: 'CSV',
          status: 'SUBMITTED',
          siteName: 'Ulwe Node Plot 45',
          location: 'Ulwe, Navi Mumbai',
          measuredAt: new Date('2026-08-02T10:00:00Z'),
          aqiValue: 96,
          pm25: 38.2,
          pm10: 80.1,
        },
      ],
    });
  }

  console.log('Seed complete.');
  console.log('  Architect : architect@example.com / Password123');
  console.log('  Officer   : officer@cidco.example / Password123');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
