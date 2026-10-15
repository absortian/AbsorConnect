<?php

namespace App\Repository;

use App\Entity\Device;
use App\Entity\User;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;
use Symfony\Component\Uid\Uuid;

/** @extends ServiceEntityRepository<Device> */
class DeviceRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, Device::class);
    }

    /** @return list<Device> */
    public function findForUser(User $user): array
    {
        return $this->findBy(['user' => $user], ['name' => 'ASC', 'createdAt' => 'ASC']);
    }

    /** Borra los equipos sin contacto desde $before (de cualquier cuenta). */
    public function deleteNotSeenSince(\DateTimeImmutable $before): int
    {
        return $this->createQueryBuilder('d')
            ->delete()
            ->where('d.lastSeenAt < :before')
            ->setParameter('before', $before)
            ->getQuery()
            ->execute();
    }

    public function findById(Uuid $id): ?Device
    {
        return $this->find($id);
    }
}
