<?php

namespace App\Repository;

use App\Entity\ConnectionEntry;
use App\Entity\User;
use Doctrine\Bundle\DoctrineBundle\Repository\ServiceEntityRepository;
use Doctrine\Persistence\ManagerRegistry;

/** @extends ServiceEntityRepository<ConnectionEntry> */
class ConnectionEntryRepository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, ConnectionEntry::class);
    }

    /** @return list<ConnectionEntry> en el orden en que la persona las guardó */
    public function findForUser(User $user): array
    {
        return $this->findBy(['user' => $user], ['position' => 'ASC']);
    }
}
