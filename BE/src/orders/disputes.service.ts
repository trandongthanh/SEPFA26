import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { ServiceOrder } from './entities/service-order.entity';
import { OrderDispute } from './entities/order-dispute.entity';
import { OpenDisputeDto, ResolveDisputeDto } from './dto/open-dispute.dto';
@Injectable()
export class DisputesService {
 constructor(@InjectRepository(OrderDispute) private readonly disputeRepo:Repository<OrderDispute>, @InjectRepository(ServiceOrder) private readonly orderRepo:Repository<ServiceOrder>, @InjectRepository(CustomerProfile) private readonly customerRepo:Repository<CustomerProfile>, @InjectRepository(ProviderProfile) private readonly providerRepo:Repository<ProviderProfile>) {}
 async open(accountId:string, orderId:string, dto:OpenDisputeDto){const order=await this.orderRepo.findOne({where:{id:orderId}});if(!order)throw new NotFoundException('ORDER_NOT_FOUND');await this.assertParty(accountId,order);if(!['HANDOVER_IN_PROGRESS','HANDOVER_AWAITING_CONFIRM','IN_CARE'].includes(order.status))throw new BadRequestException('DISPUTE_NOT_AVAILABLE');return this.disputeRepo.save(this.disputeRepo.create({serviceOrderId:order.id,openedByAccountId:accountId,status:'OPEN',reason:dto.reason,description:dto.description,evidence:dto.evidence}));}
 async list(accountId:string, orderId:string){const order=await this.orderRepo.findOne({where:{id:orderId}});if(!order)throw new NotFoundException('ORDER_NOT_FOUND');await this.assertParty(accountId,order);return this.disputeRepo.find({where:{serviceOrderId:orderId},order:{createdAt:'DESC'}});}
 async resolve(adminId:string, disputeId:string, dto:ResolveDisputeDto){const d=await this.disputeRepo.findOne({where:{id:disputeId}});if(!d)throw new NotFoundException('DISPUTE_NOT_FOUND');d.status=dto.status;d.resolution=dto.resolution;d.resolvedByAccountId=adminId;return this.disputeRepo.save(d);}
 private async assertParty(accountId:string,order:ServiceOrder){const c=await this.customerRepo.findOne({where:{id:order.customerId}});const p=await this.providerRepo.findOne({where:{id:order.providerId}});if(c?.accountId!==accountId&&p?.accountId!==accountId)throw new ForbiddenException('ORDER_PARTY_REQUIRED');}
}
