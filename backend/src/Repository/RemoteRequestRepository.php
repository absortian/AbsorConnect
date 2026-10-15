<?php

namespace App\Repository;

use App\Entity\Device;
use App\Entity\RemoteRequest;
use App\Entity\User;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Symfony\Component\Uid\Uuid;

/** @extends ServiceEntityRepository<RemoteRequest> */
class RemoteRequestRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, RemoteRequest::class);
    }

    /** @return list<RemoteRequest> sin responder ni caducar, de la más antigua a la más nueva */
    public function findPendingForDevice(Device $device, \DateTimeImmutable $now): array
    {
        return $this->createQueryBuilder('r')
            ->where('r.device = :device')
            ->andWhere('r.expiresAt > :now')
            ->andWhere('r.answer IS NULL')
            ->andWhere('r.rejection IS NULL')
            ->setParameter('device', $device->getId(), 'uuid')
            ->setParameter('now', $now)
            ->orderBy('r.createdAt', 'ASC')
            ->getQuery()
            ->getResult();
    }

    public function findOneForUser(User $user, Uuid $id): ?RemoteRequest
    {
        return $this->findOneBy(['id' => $id, 'user' => $user]);
    }

    /** Borra las caducadas (de cualquier cuenta): así no hace falta un CronJob. */
    public function deleteExpired(\DateTimeImmutable $now): int
    {
        return $this->createQueryBuilder('r')
            ->delete()
            ->where('r.expiresAt <= :now')
            ->setParameter('now', $now)
            ->getQuery()
            ->execute();
    }
}
