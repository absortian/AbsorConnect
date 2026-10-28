<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261029001500 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Compensación de altas del agente por transacción y sesión origen';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('ALTER TABLE agent_enrollment ADD transaction_id UUID DEFAULT NULL');
        $this->addSql('ALTER TABLE host_agent ADD transaction_id UUID DEFAULT NULL');
        $this->addSql('CREATE TABLE agent_enrollment_transaction (device_id UUID NOT NULL, transaction_id UUID NOT NULL, source_session_id UUID NOT NULL, state VARCHAR(16) NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, PRIMARY KEY (device_id, transaction_id))');
        $this->addSql('CREATE INDEX IDX_AGENT_ENROLLMENT_TX_SOURCE ON agent_enrollment_transaction (source_session_id)');
        $this->addSql('ALTER TABLE agent_enrollment_transaction ADD CONSTRAINT FK_AGENT_ENROLLMENT_TX_DEVICE FOREIGN KEY (device_id) REFERENCES device (id) ON DELETE CASCADE NOT DEFERRABLE');
        $this->addSql('ALTER TABLE agent_enrollment_transaction ADD CONSTRAINT FK_AGENT_ENROLLMENT_TX_SOURCE FOREIGN KEY (source_session_id) REFERENCES user_session (id) ON DELETE CASCADE NOT DEFERRABLE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('DROP TABLE agent_enrollment_transaction');
        $this->addSql('ALTER TABLE host_agent DROP transaction_id');
        $this->addSql('ALTER TABLE agent_enrollment DROP transaction_id');
    }
}
