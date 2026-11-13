import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../app.module';
import { Account } from '../accounts/entities/account.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { ServicePackage } from '../providers/entities/service-package.entity';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { Plant } from '../orders/entities/plant.entity';
import { ServiceAgreement } from '../orders/entities/service-agreement.entity';
import { InitialPhoto } from '../orders/entities/initial-photo.entity';
import { ShippingRate } from '../orders/entities/shipping-rate.entity';
import { PasswordService } from '../crypto/password.service';
import { ContractTemplateService } from '../orders/contract-template.service';
import { generateAgreementNo, generateOrderCode } from '../orders/order-code';

async function seedContractDemo() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const dataSource = app.get(DataSource);
    const passwords = app.get(PasswordService);
    const jwt = app.get(JwtService);
    const config = app.get(ConfigService);
    const contractTemplate = app.get(ContractTemplateService);

    const accountRepo = dataSource.getRepository(Account);
    const customerRepo = dataSource.getRepository(CustomerProfile);
    const providerRepo = dataSource.getRepository(ProviderProfile);
    const packageRepo = dataSource.getRepository(ServicePackage);
    const orderRepo = dataSource.getRepository(ServiceOrder);
    const plantRepo = dataSource.getRepository(Plant);
    const agreementRepo = dataSource.getRepository(ServiceAgreement);
    const shippingRateRepo = dataSource.getRepository(ShippingRate);

    // 1. Tạo ShippingRate mẫu
    const existingRate = await shippingRateRepo.findOne({ where: { isActive: true } });
    if (!existingRate) {
      await shippingRateRepo.save(
        shippingRateRepo.create({
          minKm: '0',
          maxKm: null,
          baseFee: '50000',
          perKmFee: '10000',
          isActive: true,
        }),
      );
    }

    // 2. Tạo tài khoản Khách hàng
    const customerEmail = 'khachhang.demo@lancarehub.vn';
    let customerAcc = await accountRepo.findOne({ where: { email: customerEmail } });
    if (!customerAcc) {
      customerAcc = await accountRepo.save(
        accountRepo.create({
          email: customerEmail,
          passwordHash: await passwords.hash('Password123!'),
          fullName: 'Nguyễn Văn Khách',
          phone: '0901234567',
          role: 'CUSTOMER',
          status: 'ACTIVE',
        }),
      );
    }

    let customerProf = await customerRepo.findOne({ where: { accountId: customerAcc.id } });
    if (!customerProf) {
      customerProf = await customerRepo.save(
        customerRepo.create({
          accountId: customerAcc.id,
          address: '123 Đường Hoa Lan, Phường Bến Nghé, Quận 1, TP.HCM',
          defaultPickupAddress: '123 Đường Hoa Lan, Phường Bến Nghé, Quận 1, TP.HCM',
          gpsLat: '10.776889',
          gpsLng: '106.700806',
          verificationStatus: 'APPROVED',
          cccdFrontUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
          cccdBackUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
          selfieWithIdUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
        }),
      );
    }

    // 3. Tạo tài khoản Nhà vườn
    const providerEmail = 'nhavuon.demo@lancarehub.vn';
    let providerAcc = await accountRepo.findOne({ where: { email: providerEmail } });
    if (!providerAcc) {
      providerAcc = await accountRepo.save(
        accountRepo.create({
          email: providerEmail,
          passwordHash: await passwords.hash('Password123!'),
          fullName: 'Trần Văn Vườn',
          phone: '0912345678',
          role: 'PROVIDER',
          status: 'ACTIVE',
        }),
      );
    }

    let providerProf = await providerRepo.findOne({ where: { accountId: providerAcc.id } });
    if (!providerProf) {
      providerProf = await providerRepo.save(
        providerRepo.create({
          accountId: providerAcc.id,
          providerType: 'NURSERY',
          displayName: 'Vườn Kiểng Lan Thảo Mộc',
          address: '456 Xa Lộ Hà Nội, TP. Thủ Đức, TP.HCM',
          gpsLat: '10.849889',
          gpsLng: '106.771806',
          verificationStatus: 'APPROVED',
          cccdFrontUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
          cccdBackUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
          selfieUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
        }),
      );
    }

    // 4. Tạo gói dịch vụ
    let servicePkg = await packageRepo.findOne({ where: { providerId: providerProf.id } });
    if (!servicePkg) {
      servicePkg = await packageRepo.save(
        packageRepo.create({
          providerId: providerProf.id,
          name: 'Gói Chăm Sóc Cây Quý Cao Cấp (30 Ngày)',
          description: 'Gói chăm sóc cao cấp bao gồm dưỡng rễ, tạo tán, bảo vệ cây đặc biệt.',
          durationDays: 30,
          reportFrequencyDays: 3,
          maxPlants: 5,
          basePrice: '2000000',
          minDeclaredValue: '1000000',
          maxDeclaredValue: '500000000',
          isActive: true,
          approvalStatus: 'APPROVED',
        }),
      );
    }

    // 5. Tạo Đơn hàng mẫu
    const orderCode = generateOrderCode();
    const scheduledPickupAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const order = await orderRepo.save(
      orderRepo.create({
        orderCode,
        customerId: customerProf.id,
        providerId: providerProf.id,
        servicePackageId: servicePkg.id,
        status: 'AGREEMENT_PENDING',
        plantCount: 2,
        basePriceSnapshot: servicePkg.basePrice,
        pickupFeeSnapshot: '150000',
        durationDaysSnapshot: 30,
        reportFrequencySnapshot: 3,
        provisionalTotal: '4000000',
        scheduledPickupAt,
        pickupAddress: customerProf.address,
        pickupGpsLat: customerProf.gpsLat!,
        pickupGpsLng: customerProf.gpsLng!,
        customerNote: 'Cây quý xin chăm sóc đặc biệt cẩn thận',
      }),
    );

    // 6. Tạo 2 Cây mẫu có khai báo giá trị cao
    const savedPlants = await plantRepo.save([
      plantRepo.create({
        serviceOrderId: order.id,
        name: 'Cây Mai Vàng Cổ Thụ 70 Năm',
        speciesName: 'Ochna integerrima',
        isValueDeclared: true,
        declaredValue: '50000000', // 50.000.000 VNĐ -> 120% = 60.000.000 VNĐ
      }),
      plantRepo.create({
        serviceOrderId: order.id,
        name: 'Cây Bonsai Tùng La Hán Dáng Trực',
        speciesName: 'Podocarpus macrophyllus',
        isValueDeclared: true,
        declaredValue: '20000000', // 20.000.000 VNĐ -> 120% = 24.000.000 VNĐ
      }),
    ]);

    // 6.1 Tạo ảnh hiện trạng khách chụp ban đầu cho từng cây
    const photoRepo = dataSource.getRepository(InitialPhoto);
    await photoRepo.save([
      photoRepo.create({
        plantId: savedPlants[0].id,
        photoUrl: 'https://images.unsplash.com/photo-1545241047-6083a3684587?auto=format&fit=crop&w=800&q=80',
        caption: 'Ảnh chụp gốc và tán cây Mai vàng lúc khách gửi đơn',
      }),
      photoRepo.create({
        plantId: savedPlants[1].id,
        photoUrl: 'https://images.unsplash.com/photo-1512428813834-c702c7702b78?auto=format&fit=crop&w=800&q=80',
        caption: 'Ảnh chụp dáng trực cây Tùng La Hán lúc khách gửi đơn',
      }),
    ]);

    // 7. Tạo Hợp đồng điện tử kèm Điều khoản & Chính sách bồi thường 120%
    const agreementNo = generateAgreementNo();
    await agreementRepo.save(
      agreementRepo.create({
        serviceOrderId: order.id,
        agreementNo,
        status: 'PENDING',
        termsSnapshot: {
          orderCode: order.orderCode,
          provisionalTotal: order.provisionalTotal,
          pickupFeeSnapshot: order.pickupFeeSnapshot,
          clauses: contractTemplate.generateClauses(),
          compensationPolicy: contractTemplate.generateCompensationPolicy(),
        },
      }),
    );

    // 8. Tạo Token JWT đăng nhập cho Khách hàng & Nhà vườn
    const accessSecret = config.get<string>('JWT_ACCESS_SECRET')!;
    const customerToken = jwt.sign(
      { sub: customerAcc.id, email: customerAcc.email, role: customerAcc.role, type: 'access' },
      { secret: accessSecret, expiresIn: '7d' },
    );
    const providerToken = jwt.sign(
      { sub: providerAcc.id, email: providerAcc.email, role: providerAcc.role, type: 'access' },
      { secret: accessSecret, expiresIn: '7d' },
    );

    console.log('\n======================================================');
    console.log('✅ ĐÃ TẠO XONG DỮ LIỆU MẪU ĐỂ TEST HỢP ĐỒNG ĐIỆN TỬ');
    console.log('======================================================');
    console.log(`📌 Order ID: ${order.id}`);
    console.log(`📌 Order Code: ${order.orderCode}`);
    console.log(`📌 Số hợp đồng: ${agreementNo}`);
    console.log('\n🔑 CUSTOMER TOKEN (Khách hàng):');
    console.log(customerToken);
    console.log('\n🔑 PROVIDER TOKEN (Nhà vườn):');
    console.log(providerToken);
    console.log('======================================================\n');
  } finally {
    await app.close();
  }
}

void seedContractDemo();
