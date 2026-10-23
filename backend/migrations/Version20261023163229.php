<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

final class Version20261023163229 extends AbstractMigration
{
    public function getDescription(): string
    {
        return 'Altas de un solo uso y credenciales limitadas del agente desatendido';
    }

    public function up(Schema $schema): void
    {
        $this->addSql('CREATE TABLE agent_enrollment (id UUID NOT NULL, token_hash VARCHAR(64) NOT NULL, expires_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, device_id UUID NOT NULL, source_session_id UUID NOT NULL, PRIMARY KEY (id))');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_AA9A06EEB3BC57DA ON agent_enrollment (token_hash)');
        $this->addSql('CREATE INDEX IDX_AA9A06EE94A4C7D4 ON agent_enrollment (device_id)');
        $this->addSql('CREATE INDEX IDX_AA9A06EE1D8B9DFB ON agent_enrollment (source_session_id)');
        $this->addSql('CREATE TABLE host_agent (token_hash VARCHAR(64) NOT NULL, agent_version VARCHAR(32) NOT NULL, capabilities JSONB NOT NULL, created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, last_used_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, expires_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL, device_id UUID NOT NULL, source_session_id UUID NOT NULL, PRIMARY KEY (device_id))');
        $this->addSql('CREATE UNIQUE INDEX UNIQ_85E9D16EB3BC57DA ON host_agent (token_hash)');
        $this->addSql('CREATE INDEX IDX_85E9D16E1D8B9DFB ON host_agent (source_session_id)');
        $this->addSql('ALTER TABLE agent_enrollment ADD CONSTRAINT FK_AA9A06EE94A4C7D4 FOREIGN KEY (device_id) REFERENCES device (id) ON DELETE CASCADE NOT DEFERRABLE');
        $this->addSql('ALTER TABLE agent_enrollment ADD CONSTRAINT FK_AA9A06EE1D8B9DFB FOREIGN KEY (source_session_id) REFERENCES user_session (id) ON DELETE CASCADE NOT DEFERRABLE');
        $this->addSql('ALTER TABLE host_agent ADD CONSTRAINT FK_85E9D16E94A4C7D4 FOREIGN KEY (device_id) REFERENCES device (id) ON DELETE CASCADE NOT DEFERRABLE');
        $this->addSql('ALTER TABLE host_agent ADD CONSTRAINT FK_85E9D16E1D8B9DFB FOREIGN KEY (source_session_id) REFERENCES user_session (id) ON DELETE CASCADE NOT DEFERRABLE');
    }

    public function down(Schema $schema): void
    {
        $this->addSql('ALTER TABLE agent_enrollment DROP CONSTRAINT FK_AA9A06EE94A4C7D4');
        $this->addSql('ALTER TABLE agent_enrollment DROP CONSTRAINT FK_AA9A06EE1D8B9DFB');
        $this->addSql('ALTER TABLE host_agent DROP CONSTRAINT FK_85E9D16E94A4C7D4');
        $this->addSql('ALTER TABLE host_agent DROP CONSTRAINT FK_85E9D16E1D8B9DFB');
        $this->addSql('DROP TABLE agent_enrollment');
        $this->addSql('DROP TABLE host_agent');
    }
}
